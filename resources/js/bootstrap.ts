import { route } from 'ziggy-js';

// Make route() globally available (replaces Laravel's @routes Blade directive).
// The Ziggy config is injected as a <script> tag in the HTML template.
window.route = route;
