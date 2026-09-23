// --- SINTONIZANDO SEÑALES ---
// Avisos de viaje: YA conectados a datos reales, vía la función propia en /api/travel-risks
// (evita el bloqueo de CORS de travel.state.gov). Reportes de guerra: TODAVÍA simulados,
// mientras se investiga el acceso a UCDP. EJEMPLO_WAR controla el aviso visible de esa pestaña.
const EJEMPLO_WAR = true;

const API_TRAVEL_RISKS = '/api/travel-risks';
const API_WAR_REPORTS = 'https://api.mockaroo.com/api/war-reports'; // Simulado

// --- UTILIDADES DE SEGURIDAD ---
// Todo texto que venga de una fuente externa pasa por esc() antes de insertarse en el DOM.
// Todo enlace pasa por safeUrl() antes de usarse como href.

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
}

function safeUrl(u) {
    try {
        var x = new URL(u);
        return (x.protocol === 'https:' || x.protocol === 'http:') ? x.href : '#';
    } catch (e) {
        return '#';
    }
}

function formatFecha(dateStr, tieneHora) {
    var t = Date.parse(dateStr);
    if (isNaN(t)) return 'fecha desconocida';
    var d = new Date(t);
    if (tieneHora) return d.toLocaleString();
    // Sin hora real: se muestran los componentes en UTC, tal como los dio la fuente,
    // para que el día no se corra hacia atrás según la zona horaria de quien lee.
    return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(d);
}

// --- FILTRO ANTI-ESTÁTICA ---
// Regla de la app: si un dato viene roto (fecha inválida, nivel fuera de rango), se descarta.
// La app no interpreta, solo valida la integridad de la señal.

function isValidRisk(dato) {
    const nivelesValidos = [1, 2, 3, 4];
    const fechaValida = !isNaN(new Date(dato.updatedAt).getTime());
    return nivelesValidos.includes(dato.level) && fechaValida && dato.country && dato.sourceUrl;
}

function isValidWarReport(dato) {
    const fechaValida = !isNaN(new Date(dato.date).getTime());
    return fechaValida && dato.location && dato.description;
}

// --- BANNER DE EJEMPLO ---

function updateWarExampleBanner() {
    var banner = document.getElementById('war-example-banner');
    if (banner) banner.hidden = !EJEMPLO_WAR;
}

// --- RENDERIZADO PASIVO ---
// La marca de tiempo mostrada es la del DATO más reciente recibido, no la hora del
// dispositivo: lo que importa es saber qué tan vieja es la señal.

function ultimoDato(data, campoFecha) {
    var max = null;
    data.forEach(function (item) {
        var t = Date.parse(item[campoFecha]);
        if (!isNaN(t) && (max === null || t > max.t)) max = { t: t, item: item };
    });
    return max ? max.item : null;
}

function actualizarTimestampRiesgos(data) {
    var ultimo = ultimoDato(data, 'updatedAt');
    document.getElementById('risk-timestamp').textContent = ultimo
        ? formatFecha(ultimo.updatedAt, !!ultimo.updatedAtHasTime)
        : '--';
}

function actualizarTimestampGuerra(data) {
    var ultimo = ultimoDato(data, 'date');
    // Los reportes de guerra (mock) sí traen hora completa en su fecha.
    document.getElementById('war-timestamp').textContent = ultimo ? formatFecha(ultimo.date, true) : '--';
}

function renderRisks(data) {
    const container = document.getElementById('risk-list');
    const riskLabels = { 1: 'Ejercer precaución normal', 2: 'Mayor precaución', 3: 'Reconsiderar viaje', 4: 'No viajar' };

    container.innerHTML = data.map(function (item) {
        return '<div class="card level-' + esc(item.level) + '">' +
            '<h3>' + esc(item.country) + ' - Nivel ' + esc(item.level) + '</h3>' +
            '<div>' + esc(riskLabels[item.level]) + '</div>' +
            '<div class="meta">' +
                'Fuente: <a href="' + safeUrl(item.sourceUrl) + '" target="_blank" rel="noopener noreferrer">Dept. de Estado EE.UU.</a>' +
                ' | Actualizado: ' + esc(formatFecha(item.updatedAt, !!item.updatedAtHasTime)) +
            '</div>' +
        '</div>';
    }).join('') || '<div class="empty-state">Sin señales que coincidan con la búsqueda.</div>';
}

function renderWars(data) {
    const container = document.getElementById('war-list');

    container.innerHTML = data.map(function (item) {
        return '<div class="card war-card">' +
            '<h3>' + esc(item.location) + '</h3>' +
            '<div>' + esc(item.description) + '</div>' +
            '<div class="meta">' +
                'Fuente: <a href="' + safeUrl(item.sourceUrl) + '" target="_blank" rel="noopener noreferrer">UCDP</a>' +
                ' | Fecha del suceso: ' + esc(formatFecha(item.date, true)) +
            '</div>' +
        '</div>';
    }).join('') || '<div class="empty-state">Sin señales que coincidan con la búsqueda.</div>';
}

function renderError(containerId, timestampId) {
    document.getElementById(timestampId).textContent = '--';
    document.getElementById(containerId).innerHTML =
        '<div class="error-card">No se pudo recibir la señal. Verifica tu conexión e inténtalo de nuevo más tarde.</div>';
}

// --- BÚSQUEDA POR PAÍS (filtra lo que ya se recibió; no vuelve a pedir datos) ---

var ultimosRiesgos = [];
var ultimasGuerras = [];

function normalizarTexto(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function aplicarBusquedaRiesgos() {
    var q = normalizarTexto(document.getElementById('risk-search').value);
    var filtrados = q ? ultimosRiesgos.filter(function (p) { return normalizarTexto(p.country).indexOf(q) !== -1; }) : ultimosRiesgos;
    renderRisks(filtrados);
}

function aplicarBusquedaGuerras() {
    var q = normalizarTexto(document.getElementById('war-search').value);
    var filtrados = q ? ultimasGuerras.filter(function (p) { return normalizarTexto(p.location).indexOf(q) !== -1; }) : ultimasGuerras;
    renderWars(filtrados);
}

// --- RECEPCIÓN DE DATOS ---

async function fetchTravelRisks() {
    try {
        const response = await fetch(API_TRAVEL_RISKS);
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const raw = await response.json();
        if (!Array.isArray(raw)) throw new Error('Formato de datos inválido');

        ultimosRiesgos = raw.filter(isValidRisk);
        actualizarTimestampRiesgos(ultimosRiesgos);
        aplicarBusquedaRiesgos();
    } catch (err) {
        console.error('Error recibiendo avisos de viaje:', err);
        ultimosRiesgos = [];
        renderError('risk-list', 'risk-timestamp');
    }
}

async function fetchWarReports() {
    try {
        // Simulación de respuesta UCDP — datos de ejemplo, no eventos reales
        const mockResponse = [
            { location: "Zona de ejemplo A (dato ficticio)", description: "Descripción de ejemplo para probar el diseño de la tarjeta.", date: "2023-10-10T08:00:00Z", sourceUrl: "https://ucdp.uu.se/" },
            { location: "Zona de ejemplo B (dato ficticio)", description: "Segunda descripción de ejemplo, sin relación con hechos reales.", date: "2023-10-05T09:30:00Z", sourceUrl: "https://ucdp.uu.se/" }
        ];

        // En producción: const response = await fetch(API_WAR_REPORTS); if (!response.ok) throw new Error('HTTP ' + response.status); const raw = await response.json();
        const raw = mockResponse;

        ultimasGuerras = raw.filter(isValidWarReport);
        actualizarTimestampGuerra(ultimasGuerras);
        aplicarBusquedaGuerras();
    } catch (err) {
        console.error('Error recibiendo reportes de conflicto:', err);
        ultimasGuerras = [];
        renderError('war-list', 'war-timestamp');
    }
}

document.getElementById('risk-search').addEventListener('input', aplicarBusquedaRiesgos);
document.getElementById('war-search').addEventListener('input', aplicarBusquedaGuerras);

// --- NAVEGACIÓN Y CICLO DE VIDA ---

document.querySelectorAll('#tabs button').forEach(function (btn) {
    btn.addEventListener('click', function () {
        document.querySelectorAll('.panel').forEach(function (p) { p.classList.remove('active'); });
        document.querySelectorAll('#tabs button').forEach(function (b) { b.classList.remove('active'); });
        document.getElementById(btn.dataset.target).classList.add('active');
        btn.classList.add('active');
    });
});

// Sintonizar al abrir y cada 30 minutos (auto-update sin intervención)
function init() {
    updateWarExampleBanner();
    fetchTravelRisks();
    fetchWarReports();
    setInterval(fetchTravelRisks, 1800000);
    setInterval(fetchWarReports, 1800000);
}

init();

// --- SERVICE WORKER REGISTRATION ---
if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js');
    });
}
