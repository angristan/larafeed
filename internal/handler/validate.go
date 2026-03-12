package handler

import (
	"fmt"
	"net/http"
	"reflect"
	"strings"

	"github.com/go-playground/validator/v10"
	gonertia "github.com/romsar/gonertia/v2"
)

var validate *validator.Validate

func init() {
	validate = validator.New(validator.WithRequiredStructEnabled())
	// Use json tag names as field identifiers in validation errors.
	validate.RegisterTagNameFunc(func(fld reflect.StructField) string {
		name := strings.SplitN(fld.Tag.Get("json"), ",", 2)[0]
		if name == "" || name == "-" {
			return fld.Name
		}
		return name
	})
}

// validateRequest runs struct-tag validation and returns Laravel-style error messages.
// Returns nil if there are no errors.
func validateRequest(req any) map[string]string {
	err := validate.Struct(req)
	if err == nil {
		return nil
	}

	labels := extractLabels(req)
	errs := map[string]string{}

	for _, fe := range err.(validator.ValidationErrors) {
		field := fe.Field()
		label := labels[field]
		if label == "" {
			label = field
		}

		switch fe.Tag() {
		case "required":
			errs[field] = fmt.Sprintf("The %s field is required.", label)
		case "min":
			errs[field] = fmt.Sprintf("The %s must be at least %s characters.", label, fe.Param())
		case "max":
			errs[field] = fmt.Sprintf("The %s must not exceed %s characters.", label, fe.Param())
		case "eqfield":
			errs[field] = fmt.Sprintf("The %s confirmation does not match.", label)
		case "email":
			errs[field] = fmt.Sprintf("The %s must be a valid email address.", label)
		default:
			errs[field] = fmt.Sprintf("The %s field is invalid.", label)
		}
	}

	return errs
}

// extractLabels builds a map from json tag name to human-readable label.
// If a struct field has a `label` tag, it is used; otherwise the json tag name
// is converted by replacing underscores with spaces.
func extractLabels(req any) map[string]string {
	labels := map[string]string{}
	t := reflect.TypeOf(req)
	if t.Kind() == reflect.Ptr {
		t = t.Elem()
	}
	for i := 0; i < t.NumField(); i++ {
		f := t.Field(i)
		jsonName := strings.SplitN(f.Tag.Get("json"), ",", 2)[0]
		if jsonName == "" || jsonName == "-" {
			continue
		}
		if label := f.Tag.Get("label"); label != "" {
			labels[jsonName] = label
		} else {
			labels[jsonName] = strings.ReplaceAll(jsonName, "_", " ")
		}
	}
	return labels
}

// validationErrs accumulates custom validation errors for business logic
// that cannot be expressed as struct tags (e.g., email uniqueness, password checks).
type validationErrs struct {
	errors map[string]string
}

func newValidationErrs() *validationErrs {
	return &validationErrs{errors: map[string]string{}}
}

// Add records a custom error. It does not overwrite an existing error for the same key.
func (v *validationErrs) Add(key, message string) *validationErrs {
	if v.errors[key] == "" {
		v.errors[key] = message
	}
	return v
}

// HasErrors returns true if any errors have been recorded.
func (v *validationErrs) HasErrors() bool {
	return len(v.errors) > 0
}

// Map returns the collected errors, or nil if there are none.
func (v *validationErrs) Map() map[string]string {
	if len(v.errors) == 0 {
		return nil
	}
	return v.errors
}

// validationError sets Inertia validation errors and redirects back.
func validationError(w http.ResponseWriter, r *http.Request, i *gonertia.Inertia, errors map[string]string) {
	ve := gonertia.ValidationErrors{}
	for k, v := range errors {
		ve[k] = v
	}
	ctx := gonertia.SetValidationErrors(r.Context(), ve)
	r = r.WithContext(ctx)
	i.Back(w, r)
}
