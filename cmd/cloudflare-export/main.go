package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
)

func main() {
	err := run(os.Args[1:])
	if err != nil {
		fmt.Fprintf(os.Stderr, "cloudflare-export: %v\n", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) == 0 {
		return errors.New("command required: export, validate, or render")
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	switch args[0] {
	case "export":
		flags := flag.NewFlagSet("export", flag.ContinueOnError)
		outputDir := flags.String("output-dir", "", "new or empty artifact output directory")
		chunkSize := flags.Int("chunk-size", 500, "maximum rows per JSONL and SQL chunk")
		adminUserID := flags.Int64("admin-user-id", 0, "source user ID to retain as administrator")
		dryRun := flags.Bool("dry-run", false, "write source metadata only")
		err := flags.Parse(args[1:])
		if err != nil {
			return err
		}
		if *outputDir == "" {
			return errors.New("export requires explicit --output-dir")
		}
		databaseURL := os.Getenv("DATABASE_URL")
		if databaseURL == "" {
			return errors.New("export requires DATABASE_URL in the environment")
		}
		var selectedAdmin *int64
		if *adminUserID != 0 {
			err = validateSafeID(*adminUserID)
			if err != nil {
				return fmt.Errorf("invalid --admin-user-id: %w", err)
			}
			selectedAdmin = adminUserID
		} else if !*dryRun {
			return errors.New("export requires explicit --admin-user-id")
		}
		err = requireEmptyDirectory(*outputDir)
		if err != nil {
			return err
		}
		err = exportPostgres(ctx, databaseURL, *outputDir, *chunkSize, *dryRun, selectedAdmin)
		if err != nil {
			return err
		}
		if *dryRun {
			fmt.Printf("metadata manifest written to %s\n", filepath.Join(*outputDir, "manifest.json"))
		} else {
			fmt.Printf("validated-source artifact written to %s\n", *outputDir)
		}
		return nil
	case "validate":
		flags := flag.NewFlagSet("validate", flag.ContinueOnError)
		outputDir := flags.String("output-dir", "", "artifact directory")
		err := flags.Parse(args[1:])
		if err != nil {
			return err
		}
		if *outputDir == "" {
			return errors.New("validate requires explicit --output-dir")
		}
		manifest, err := validateArtifact(*outputDir)
		if err != nil {
			return err
		}
		fmt.Printf("artifact valid: %d target tables\n", len(manifest.Tables))
		return nil
	case "render":
		flags := flag.NewFlagSet("render", flag.ContinueOnError)
		outputDir := flags.String("output-dir", "", "artifact directory")
		sqlDir := flags.String("sql-dir", "", "local SQL output directory")
		err := flags.Parse(args[1:])
		if err != nil {
			return err
		}
		if *outputDir == "" || *sqlDir == "" {
			return errors.New("render requires explicit --output-dir and --sql-dir")
		}
		err = renderSQL(*outputDir, *sqlDir)
		if err != nil {
			return err
		}
		fmt.Printf("local SQL chunks written to %s\n", *sqlDir)
		return nil
	default:
		return fmt.Errorf("unknown command %q: expected export, validate, or render", args[0])
	}
}

func requireEmptyDirectory(path string) error {
	entries, err := os.ReadDir(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("inspect output directory: %w", err)
	}
	if len(entries) != 0 {
		return fmt.Errorf("output directory %s must be empty", path)
	}
	return nil
}
