package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

func renderSQL(artifactDir, sqlDir string) error {
	manifest, err := validateArtifact(artifactDir)
	if err != nil {
		return err
	}
	if filepath.Clean(artifactDir) == filepath.Clean(sqlDir) {
		return fmt.Errorf("SQL output directory must differ from artifact directory")
	}
	err = os.MkdirAll(sqlDir, 0o700)
	if err != nil {
		return fmt.Errorf("create SQL directory: %w", err)
	}
	matches, err := filepath.Glob(filepath.Join(sqlDir, "*.sql"))
	if err != nil {
		return fmt.Errorf("list old SQL chunks: %w", err)
	}
	for _, match := range matches {
		err = os.Remove(match)
		if err != nil {
			return fmt.Errorf("remove old SQL chunk %s: %w", filepath.Base(match), err)
		}
	}
	err = writeCleanSQL(sqlDir)
	if err != nil {
		return err
	}
	for _, table := range manifest.Tables {
		for _, chunk := range table.Chunks {
			err = renderChunk(artifactDir, sqlDir, table, chunk)
			if err != nil {
				return err
			}
		}
	}
	return writeValidationSQL(sqlDir, manifest)
}

func writeCleanSQL(sqlDir string) error {
	var builder strings.Builder
	builder.WriteString("-- Clean-target rehearsal import. Apply target D1 schema before this file.\n")
	builder.WriteString("PRAGMA foreign_keys = ON;\nBEGIN IMMEDIATE;\n")
	for _, table := range cleanTargetDeleteOrder {
		builder.WriteString("DELETE FROM ")
		builder.WriteString(table)
		builder.WriteString(";\n")
	}
	builder.WriteString("COMMIT;\n")
	return writeSQLFile(filepath.Join(sqlDir, "0000-clean-target.sql"), builder.String())
}

func renderChunk(artifactDir, sqlDir string, table TableStats, chunk ChunkInfo) error {
	input, err := os.Open(filepath.Join(artifactDir, chunk.File))
	if err != nil {
		return fmt.Errorf("open %s: %w", chunk.File, err)
	}
	defer input.Close() //nolint:errcheck

	outputName := strings.TrimSuffix(chunk.File, ".jsonl") + ".sql"
	output, err := os.OpenFile(filepath.Join(sqlDir, outputName), os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return fmt.Errorf("create %s: %w", outputName, err)
	}
	writer := bufio.NewWriterSize(output, 64*1024)
	fail := func(cause error) error {
		closeErr := output.Close()
		if closeErr != nil {
			return fmt.Errorf("%w; close %s: %v", cause, outputName, closeErr)
		}
		return cause
	}
	_, err = fmt.Fprintf(writer, "-- Artifact %d; %s; SHA-256 %s\nPRAGMA foreign_keys = ON;\nBEGIN IMMEDIATE;\n", artifactVersion, chunk.File, chunk.SHA256)
	if err != nil {
		return fail(err)
	}
	reader := bufio.NewReaderSize(input, 64*1024)
	for row := 1; row <= chunk.Rows; row++ {
		line, err := reader.ReadBytes('\n')
		if err != nil {
			return fail(fmt.Errorf("read %s row %d: %w", chunk.File, row, err))
		}
		var record Record
		err = json.Unmarshal(line, &record)
		if err != nil {
			return fail(fmt.Errorf("decode %s row %d: %w", chunk.File, row, err))
		}
		_, err = fmt.Fprintf(writer, "INSERT INTO %s (%s) VALUES (", table.Name, strings.Join(table.Columns, ", "))
		if err != nil {
			return fail(err)
		}
		for index, value := range record.Values {
			if index > 0 {
				_, err = writer.WriteString(", ")
				if err != nil {
					return fail(err)
				}
			}
			_, err = writer.WriteString(sqlLiteral(value))
			if err != nil {
				return fail(err)
			}
		}
		_, err = writer.WriteString(") ON CONFLICT DO NOTHING;\n")
		if err != nil {
			return fail(err)
		}
	}
	_, err = writer.WriteString("COMMIT;\n")
	if err != nil {
		return fail(err)
	}
	err = writer.Flush()
	if err != nil {
		return fail(fmt.Errorf("flush %s: %w", outputName, err))
	}
	err = output.Close()
	if err != nil {
		return fmt.Errorf("close %s: %w", outputName, err)
	}
	return nil
}

func sqlLiteral(value Value) string {
	switch value.Kind {
	case "null":
		return "NULL"
	case "integer":
		return fmt.Sprintf("%d", value.Int)
	case "text":
		return "'" + strings.ReplaceAll(value.Text, "'", "''") + "'"
	case "blob":
		return "X'" + strings.ToUpper(value.Hex) + "'"
	default:
		panic("artifact must be validated before rendering")
	}
}

func writeValidationSQL(sqlDir string, manifest Manifest) error {
	var builder strings.Builder
	builder.WriteString("-- These queries must return no rows except the labeled count report.\n")
	builder.WriteString("PRAGMA foreign_keys = ON;\nPRAGMA foreign_key_check;\nPRAGMA integrity_check;\n")
	builder.WriteString("SELECT 'table', 'expected_rows', 'actual_rows';\n")
	for _, table := range manifest.Tables {
		fmt.Fprintf(&builder, "SELECT '%s', %d, COUNT(*) FROM %s;\n", table.Name, table.OutputCount, table.Name)
	}
	builder.WriteString("SELECT 'invalid_safe_id', id, NULL FROM users WHERE id < 1 OR id > 9007199254740991;\n")
	builder.WriteString("SELECT 'invalid_content_size', entry_id, encoded_size_bytes FROM entry_contents WHERE encoded_size_bytes != length(CAST(content_html AS BLOB)) OR encoded_size_bytes > 1800000;\n")
	return writeSQLFile(filepath.Join(sqlDir, "9999-validate.sql"), builder.String())
}

func writeSQLFile(path, content string) error {
	err := os.WriteFile(path, []byte(content), 0o600)
	if err != nil {
		return fmt.Errorf("write %s: %w", filepath.Base(path), err)
	}
	return nil
}
