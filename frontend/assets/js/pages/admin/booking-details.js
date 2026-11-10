import { $, params } from '../../ui.js';
import { initDashboard } from '/components/dashboard-shell.js';
import { renderBookingPanel } from '/components/booking-panel.js';

const user = await initDashboard({ area: 'ADMIN', active: 'bookings', title: 'Reservation' });
renderBookingPanel($('#app'), params().id, user, { backHref: '/admin/bookings.html', backLabel: 'All reservations' });
