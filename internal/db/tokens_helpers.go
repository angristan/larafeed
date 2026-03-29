package db

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
)

func GeneratePlainToken(length int) string {
	b := make([]byte, length)
	_, err := rand.Read(b)
	if err != nil {
		panic(fmt.Sprintf("crypto/rand.Read failed: %v", err))
	}
	return hex.EncodeToString(b)[:length]
}

func HashToken(plaintext string) string {
	h := sha256.Sum256([]byte(plaintext))
	return fmt.Sprintf("%x", h)
}

