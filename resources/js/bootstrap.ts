import axios from 'axios';
import { route } from 'ziggy-js';

window.axios = axios;
window.axios.defaults.headers.common['X-Requested-With'] = 'XMLHttpRequest';

// Make route() globally available (replaces Laravel's @routes Blade directive).
// The Ziggy config is injected as a <script> tag in the HTML template.
(window as any).route = route;
