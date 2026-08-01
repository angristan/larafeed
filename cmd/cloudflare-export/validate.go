package main

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"reflect"
)

func validateArtifact(root string) (Manifest, error) {
	manifest, err := readManifest(root)
	if err != nil {
		return Manifest{}, err
	}
	if manifest.ArtifactVersion != artifactVersion {
		return Manifest{}, fmt.Errorf("unsupported artifact version %d", manifest.ArtifactVersion)
	}
	if manifest.DryRun {
		return Manifest{}, fmt.Errorf("dry-run manifest has metadata only and cannot be rendered")
	}
	if manifest.MaxChunkBytes != maxArtifactChunkBytes {
		return Manifest{}, fmt.Errorf("manifest chunk byte limit is %d, want %d", manifest.MaxChunkBytes, maxArtifactChunkBytes)
	}
	if len(manifest.Tables) != len(foreignKeyOrder) {
		return Manifest{}, fmt.Errorf("manifest has %d tables, want %d", len(manifest.Tables), len(foreignKeyOrder))
	}
	if manifest.AdminUserID == nil {
		return Manifest{}, fmt.Errorf("manifest has no selected administrator")
	}
	err = validateSafeID(*manifest.AdminUserID)
	if err != nil {
		return Manifest{}, fmt.Errorf("manifest administrator: %w", err)
	}
	for tableIndex, table := range manifest.Tables {
		if table.Name != foreignKeyOrder[tableIndex] {
			return Manifest{}, fmt.Errorf("table %d is %q, want %q", tableIndex, table.Name, foreignKeyOrder[tableIndex])
		}
		if !reflect.DeepEqual(table.Columns, tableColumns[table.Name]) {
			return Manifest{}, fmt.Errorf("%s columns do not match artifact contract", table.Name)
		}
		var count int64
		var minimum, maximum *int64
		for chunkIndex, chunk := range table.Chunks {
			wantFile := fmt.Sprintf("%02d-%s-%06d.jsonl", tableIndex+1, table.Name, chunkIndex+1)
			if chunk.File != wantFile {
				return Manifest{}, fmt.Errorf("%s chunk filename is not deterministic", table.Name)
			}
			path := filepath.Join(root, chunk.File)
			data, err := os.ReadFile(path)
			if err != nil {
				return Manifest{}, fmt.Errorf("read %s: %w", chunk.File, err)
			}
			if len(data) > manifest.MaxChunkBytes {
				return Manifest{}, fmt.Errorf("%s exceeds chunk byte limit", chunk.File)
			}
			hash := sha256.Sum256(data)
			if fmt.Sprintf("%x", hash[:]) != chunk.SHA256 {
				return Manifest{}, fmt.Errorf("%s SHA-256 mismatch", chunk.File)
			}
			rows, chunkMin, chunkMax, err := validateChunk(data, table)
			if err != nil {
				return Manifest{}, fmt.Errorf("validate %s: %w", chunk.File, err)
			}
			if rows != chunk.Rows {
				return Manifest{}, fmt.Errorf("%s has %d rows, manifest says %d", chunk.File, rows, chunk.Rows)
			}
			if !equalOptionalInt(chunkMin, chunk.MinID) || !equalOptionalInt(chunkMax, chunk.MaxID) {
				return Manifest{}, fmt.Errorf("%s identifier range mismatch", chunk.File)
			}
			count += int64(rows)
			updateRange(&minimum, &maximum, chunkMin)
			updateRange(&minimum, &maximum, chunkMax)
		}
		if count != table.OutputCount {
			return Manifest{}, fmt.Errorf("%s has %d rows, manifest says %d", table.Name, count, table.OutputCount)
		}
		if !equalOptionalInt(minimum, table.MinID) || !equalOptionalInt(maximum, table.MaxID) {
			return Manifest{}, fmt.Errorf("%s table identifier range mismatch", table.Name)
		}
	}
	err = validateArtifactAdministrator(root, manifest.Tables[0], *manifest.AdminUserID)
	if err != nil {
		return Manifest{}, err
	}
	return manifest, nil
}

func validateArtifactAdministrator(root string, users TableStats, adminUserID int64) error {
	admins := 0
	selectedFound := false
	for _, chunk := range users.Chunks {
		file, err := os.Open(filepath.Join(root, chunk.File))
		if err != nil {
			return fmt.Errorf("open users chunk for administrator validation: %w", err)
		}
		scanner := bufio.NewScanner(file)
		scanner.Buffer(make([]byte, 64*1024), maxArtifactChunkBytes)
		closeWith := func(cause error) error {
			closeErr := file.Close()
			if closeErr != nil {
				return fmt.Errorf("%w; close users chunk: %v", cause, closeErr)
			}
			return cause
		}
		for scanner.Scan() {
			var record Record
			err = json.Unmarshal(scanner.Bytes(), &record)
			if err != nil {
				return closeWith(fmt.Errorf("decode users administrator row: %w", err))
			}
			id, isAdmin := record.Values[0], record.Values[5]
			if id.Kind == "integer" && id.Int == adminUserID {
				selectedFound = true
				if isAdmin.Kind != "integer" || isAdmin.Int != 1 {
					return closeWith(fmt.Errorf("selected administrator %d is not marked admin", adminUserID))
				}
			}
			if isAdmin.Kind == "integer" && isAdmin.Int == 1 {
				admins++
			} else if isAdmin.Kind != "integer" || isAdmin.Int != 0 {
				return closeWith(fmt.Errorf("user row has invalid is_admin value"))
			}
		}
		err = scanner.Err()
		if err != nil {
			return closeWith(fmt.Errorf("scan users administrator rows: %w", err))
		}
		err = file.Close()
		if err != nil {
			return fmt.Errorf("close users chunk: %w", err)
		}
	}
	if !selectedFound || admins != 1 {
		return fmt.Errorf("administrator invariant failed: selected=%t admins=%d", selectedFound, admins)
	}
	return nil
}

func validateChunk(data []byte, table TableStats) (int, *int64, *int64, error) {
	reader := bufio.NewReaderSize(bytesReader(data), 64*1024)
	rows := 0
	var minimum, maximum *int64
	for {
		line, err := reader.ReadBytes('\n')
		if len(line) > 0 {
			if line[len(line)-1] != '\n' {
				return 0, nil, nil, fmt.Errorf("final record is missing newline")
			}
			var record Record
			decoder := json.NewDecoder(bytesReader(line))
			decoder.DisallowUnknownFields()
			decodeErr := decoder.Decode(&record)
			if decodeErr != nil {
				return 0, nil, nil, fmt.Errorf("row %d: %w", rows+1, decodeErr)
			}
			trailingErr := decoder.Decode(&struct{}{})
			if trailingErr != io.EOF {
				return 0, nil, nil, fmt.Errorf("row %d has trailing data", rows+1)
			}
			if len(record.Values) != len(table.Columns) {
				return 0, nil, nil, fmt.Errorf("row %d has %d values, want %d", rows+1, len(record.Values), len(table.Columns))
			}
			validationErr := validateRecord(table.Name, record)
			if validationErr != nil {
				return 0, nil, nil, fmt.Errorf("row %d: %w", rows+1, validationErr)
			}
			primary := record.Values[0].Int
			updateRange(&minimum, &maximum, &primary)
			rows++
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return 0, nil, nil, err
		}
	}
	return rows, minimum, maximum, nil
}

func validateRecord(table string, record Record) error {
	for index, value := range record.Values {
		switch value.Kind {
		case "null":
			if value.Int != 0 || value.Text != "" || value.Hex != "" {
				return fmt.Errorf("column %s has non-empty null payload", tableColumns[table][index])
			}
		case "integer":
			if value.Text != "" || value.Hex != "" {
				return fmt.Errorf("column %s has mixed integer payload", tableColumns[table][index])
			}
		case "text":
			if value.Int != 0 || value.Hex != "" {
				return fmt.Errorf("column %s has mixed text payload", tableColumns[table][index])
			}
		case "blob":
			if value.Int != 0 || value.Text != "" {
				return fmt.Errorf("column %s has mixed blob payload", tableColumns[table][index])
			}
			if len(value.Hex)%2 != 0 {
				return fmt.Errorf("column %s has odd BLOB hex", tableColumns[table][index])
			}
			_, err := hex.DecodeString(value.Hex)
			if err != nil {
				return fmt.Errorf("column %s has invalid BLOB hex", tableColumns[table][index])
			}
		default:
			return fmt.Errorf("column %s has unknown value kind %q", tableColumns[table][index], value.Kind)
		}
	}
	for _, position := range tableIDPositions[table] {
		value := record.Values[position]
		if value.Kind == "null" {
			continue
		}
		if value.Kind != "integer" {
			return fmt.Errorf("identifier column %s is not integer", tableColumns[table][position])
		}
		err := validateSafeID(value.Int)
		if err != nil {
			return fmt.Errorf("identifier column %s: %w", tableColumns[table][position], err)
		}
	}
	if record.Values[0].Kind != "integer" {
		return fmt.Errorf("primary identifier is not integer")
	}
	blobLengths := map[string]map[int]int{
		"users":           {1: 32},
		"entries":         {2: 32},
		"entry_contents":  {2: 32},
		"app_tokens":      {3: 32},
		"entry_summaries": {4: 32},
	}
	for position, byteLength := range blobLengths[table] {
		value := record.Values[position]
		if value.Kind != "blob" || len(value.Hex) != byteLength*2 {
			return fmt.Errorf("column %s is not a %d-byte BLOB", tableColumns[table][position], byteLength)
		}
	}
	if table == "app_tokens" {
		feverVerifier := record.Values[10]
		if feverVerifier.Kind != "null" && (feverVerifier.Kind != "blob" || len(feverVerifier.Hex) != 64) {
			return fmt.Errorf("fever_verifier_hash is not null or a 32-byte BLOB")
		}
		err := validateJSONString(record.Values[5])
		if err != nil {
			return fmt.Errorf("scopes_json: %w", err)
		}
	}
	if table == "feed_subscriptions" && record.Values[4].Kind != "null" {
		err := validateJSONString(record.Values[4])
		if err != nil {
			return fmt.Errorf("filter_rules_json: %w", err)
		}
	}
	if table == "entry_contents" {
		content := record.Values[1]
		size := record.Values[3]
		if content.Kind != "text" || size.Kind != "integer" || int64(len([]byte(content.Text))) != size.Int || size.Int > maxContentBytes {
			return fmt.Errorf("entry content size is inconsistent or oversized")
		}
	}
	return nil
}

func validateJSONString(value Value) error {
	if value.Kind != "text" || !json.Valid([]byte(value.Text)) {
		return fmt.Errorf("not valid JSON text")
	}
	return nil
}

func equalOptionalInt(left, right *int64) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
}

// bytesReader avoids importing bytes at each call site while keeping decoder input immutable.
type byteSliceReader struct {
	data   []byte
	offset int
}

func bytesReader(data []byte) *byteSliceReader { return &byteSliceReader{data: data} }
func (r *byteSliceReader) Read(target []byte) (int, error) {
	if r.offset >= len(r.data) {
		return 0, io.EOF
	}
	count := copy(target, r.data[r.offset:])
	r.offset += count
	return count, nil
}
