// Package apperr provides structured error types for the application layer.
// Services return these errors; handlers map them to HTTP status codes using
// errors.As, either directly or via the handler.handleServiceError helper.
package apperr

import "fmt"

// NotFoundError indicates the requested resource does not exist (HTTP 404).
type NotFoundError struct {
	Resource string // e.g. "category", "feed"
}

func (e *NotFoundError) Error() string {
	if e.Resource != "" {
		return e.Resource + " not found"
	}
	return "not found"
}

// NewNotFound creates a NotFoundError for the given resource.
func NewNotFound(resource string) *NotFoundError {
	return &NotFoundError{Resource: resource}
}

// ValidationError indicates invalid input or a business rule violation (HTTP 422).
// Field is the form field name (e.g. "email", "feed_url").
type ValidationError struct {
	Field   string
	Message string
}

func (e *ValidationError) Error() string {
	return e.Message
}

// NewValidation creates a ValidationError for the given field.
func NewValidation(field, message string) *ValidationError {
	return &ValidationError{Field: field, Message: message}
}

// ConflictError indicates a duplicate or conflicting resource (HTTP 409).
type ConflictError struct {
	Resource string
	Message  string
}

func (e *ConflictError) Error() string {
	if e.Message != "" {
		return e.Message
	}
	return fmt.Sprintf("%s already exists", e.Resource)
}

// NewConflict creates a ConflictError for the given resource.
func NewConflict(resource, message string) *ConflictError {
	return &ConflictError{Resource: resource, Message: message}
}
