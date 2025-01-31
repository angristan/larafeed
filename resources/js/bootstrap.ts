import axios from 'axios';
import Echo from 'laravel-echo';
import { WaveConnector } from 'laravel-wave';

window.axios = axios;

window.axios.defaults.headers.common['X-Requested-With'] = 'XMLHttpRequest';

window.Echo = new Echo({ broadcaster: WaveConnector });
