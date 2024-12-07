<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreFeedRequest extends FormRequest
{
    /**
     * Determine if the user is authorized to make this request.
     */
    public function authorize(): bool
    {
        return true;
    }

    /**
     * Get the validation rules that apply to the request.
     *
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'feed_url' => ['required', 'max:255', 'url'],
        ];
    }

    /**
     * Get the error messages for the defined validation rules.
     *
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'feed_url.required' => 'Please enter a feed URL',
            'feed_url.url' => 'Please enter a valid URL',
            'feed_url.max' => 'Please enter a URL that is less than 255 characters',
        ];
    }
}
