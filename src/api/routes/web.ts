import { get } from '../server.ts';
import { dashboardHtml } from '../../web/dashboard.ts';

get('/', () => dashboardHtml(), { public: true });
get('/dashboard', () => dashboardHtml(), { public: true });
