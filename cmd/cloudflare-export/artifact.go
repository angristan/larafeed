package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

type artifactWriter struct {
	root      string
	chunkSize int
	manifest  Manifest
	tables    map[string]*tableWriter
}

type tableWriter struct {
	owner      *artifactWriter
	stats      *TableStats
	chunkIndex int
	buffer     bytes.Buffer
	rows       int
	minID      *int64
	maxID      *int64
}

func newArtifactWriter(root string, chunkSize int, manifest Manifest) (*artifactWriter, error) {
	if chunkSize < 1 || chunkSize > 10_000 {
		return nil, fmt.Errorf("chunk size must be between 1 and 10000")
	}
	err := os.MkdirAll(root, 0o700)
	if err != nil {
		return nil, fmt.Errorf("create output directory: %w", err)
	}
	manifest.MaxChunkBytes = maxArtifactChunkBytes
	writer := &artifactWriter{root: root, chunkSize: chunkSize, manifest: manifest, tables: make(map[string]*tableWriter)}
	for _, name := range foreignKeyOrder {
		writer.manifest.Tables = append(writer.manifest.Tables, TableStats{
			Name: name, Columns: append([]string(nil), tableColumns[name]...),
		})
	}
	for index := range writer.manifest.Tables {
		stats := &writer.manifest.Tables[index]
		writer.tables[stats.Name] = &tableWriter{owner: writer, stats: stats}
	}
	return writer, nil
}

func (w *artifactWriter) append(table string, record Record, primaryID *int64) error {
	tableWriter, ok := w.tables[table]
	if !ok {
		return fmt.Errorf("unknown target table %q", table)
	}
	if len(record.Values) != len(tableWriter.stats.Columns) {
		return fmt.Errorf("%s record has %d values, want %d", table, len(record.Values), len(tableWriter.stats.Columns))
	}
	data, err := marshalRecord(record)
	if err != nil {
		return err
	}
	if len(data) > maxArtifactChunkBytes {
		return fmt.Errorf("%s record exceeds artifact chunk byte limit", table)
	}
	if tableWriter.rows > 0 && tableWriter.buffer.Len()+len(data) > maxArtifactChunkBytes {
		err = tableWriter.flush()
		if err != nil {
			return err
		}
	}
	_, err = tableWriter.buffer.Write(data)
	if err != nil {
		return fmt.Errorf("buffer %s record: %w", table, err)
	}
	tableWriter.rows++
	tableWriter.stats.OutputCount++
	updateRange(&tableWriter.stats.MinID, &tableWriter.stats.MaxID, primaryID)
	updateRange(&tableWriter.minID, &tableWriter.maxID, primaryID)
	if tableWriter.rows == w.chunkSize {
		return tableWriter.flush()
	}
	return nil
}

func updateRange(minimum, maximum **int64, value *int64) {
	if value == nil {
		return
	}
	if *minimum == nil || *value < **minimum {
		copy := *value
		*minimum = &copy
	}
	if *maximum == nil || *value > **maximum {
		copy := *value
		*maximum = &copy
	}
}

func (w *tableWriter) flush() error {
	if w.rows == 0 {
		return nil
	}
	w.chunkIndex++
	name := fmt.Sprintf("%02d-%s-%06d.jsonl", tableOrder(w.stats.Name), w.stats.Name, w.chunkIndex)
	path := filepath.Join(w.owner.root, name)
	data := append([]byte(nil), w.buffer.Bytes()...)
	err := os.WriteFile(path, data, 0o600)
	if err != nil {
		return fmt.Errorf("write %s: %w", name, err)
	}
	hash := sha256.Sum256(data)
	w.stats.Chunks = append(w.stats.Chunks, ChunkInfo{
		File: name, Rows: w.rows, SHA256: fmt.Sprintf("%x", hash[:]), MinID: w.minID, MaxID: w.maxID,
	})
	w.buffer.Reset()
	w.rows = 0
	w.minID = nil
	w.maxID = nil
	return nil
}

func tableOrder(name string) int {
	for index, candidate := range foreignKeyOrder {
		if candidate == name {
			return index + 1
		}
	}
	return 99
}

func (w *artifactWriter) finish() error {
	for _, name := range foreignKeyOrder {
		err := w.tables[name].flush()
		if err != nil {
			return err
		}
	}
	return writeManifest(w.root, w.manifest)
}

func writeManifest(root string, manifest Manifest) error {
	data, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal manifest: %w", err)
	}
	data = append(data, '\n')
	err = os.WriteFile(filepath.Join(root, "manifest.json"), data, 0o600)
	if err != nil {
		return fmt.Errorf("write manifest: %w", err)
	}
	return nil
}

func readManifest(root string) (Manifest, error) {
	data, err := os.ReadFile(filepath.Join(root, "manifest.json"))
	if err != nil {
		return Manifest{}, fmt.Errorf("read manifest: %w", err)
	}
	var manifest Manifest
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	err = decoder.Decode(&manifest)
	if err != nil {
		return Manifest{}, fmt.Errorf("decode manifest: %w", err)
	}
	return manifest, nil
}
