// --- SINTONIZANDO SEÑALES ---
// Las dos pestañas ya están conectadas a datos reales, cada una por su función propia en el
// servidor (evita el bloqueo de CORS de las fuentes originales, travel.state.gov y UCDP).

const API_TRAVEL_RISKS = '/api/travel-risks';
const API_WAR_REPORTS = '/api/war-reports';

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

var TIPOS_VALIDOS = ['conflicto_estatal', 'conflicto_no_estatal', 'violencia_unilateral'];
function isValidWarReport(dato) {
    const fechaValida = !isNaN(new Date(dato.fecha).getTime());
    return fechaValida && dato.pais && dato.lugar && TIPOS_VALIDOS.includes(dato.tipo);
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
    var ultimo = ultimoDato(data, 'fecha');
    document.getElementById('war-timestamp').textContent = ultimo ? formatFecha(ultimo.fecha, false) : '--';
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

var fuenteGuerra = { nombre: 'UCDP', url: 'https://ucdp.uu.se/downloads/candidateged/' };
// UCDP no da un enlace por cada evento (solo cita el medio de prensa, y eso se omite a
// propósito de esta app). El enlace de "Fuente" es el mismo para todas las tarjetas.

var TIPO_LABELS = {
    'conflicto_estatal': 'Conflicto estatal',
    'conflicto_no_estatal': 'Conflicto no estatal',
    'violencia_unilateral': 'Violencia unilateral'
};

function renderWars(data) {
    const container = document.getElementById('war-list');
    const srcHref = safeUrl(fuenteGuerra.url);

    container.innerHTML = data.map(function (item) {
        var muertesTxt = (typeof item.muertes_reportadas === 'number')
            ? item.muertes_reportadas + (item.muertes_reportadas === 1 ? ' muerte reportada' : ' muertes reportadas')
            : 'Muertes reportadas: sin confirmar';
        return '<div class="card war-card">' +
            '<h3>' + esc(item.lugar) + '</h3>' +
            '<div>' + esc(TIPO_LABELS[item.tipo] || item.tipo) + ' · ' + esc(muertesTxt) + '</div>' +
            '<div class="meta">' +
                'Fuente: <a href="' + srcHref + '" target="_blank" rel="noopener noreferrer">' + esc(fuenteGuerra.nombre) + '</a>' +
                ' | Fecha del suceso: ' + esc(formatFecha(item.fecha, false)) +
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

// Nombres en español de los países cuyo nombre en inglés (el que traen las fuentes) es
// notablemente distinto. Solo cubre los casos donde de verdad hace falta una traducción;
// los países cuyo nombre ya se escribe casi igual en los dos idiomas no están aquí, porque
// normalizarTexto() ya les quita los acentos y los iguala. Las claves están ya normalizadas
// (minúsculas, sin acentos) para comparar directo contra el nombre que llega de la fuente.
var NOMBRES_ES = {
    'afghanistan': 'afganistan', 'algeria': 'argelia', 'antigua and barbuda': 'antigua y barbuda',
    'azerbaijan': 'azerbaiyan', 'bahrain': 'bahrein', 'belarus': 'bielorrusia', 'belgium': 'belgica',
    'bhutan': 'butan', 'bosnia and herzegovina': 'bosnia y herzegovina', 'brazil': 'brasil',
    'cambodia': 'camboya', 'cameroon': 'camerun', 'central african republic': 'republica centroafricana',
    'comoros': 'comoras', 'democratic republic of the congo': 'republica democratica del congo',
    'cote d\'ivoire': 'costa de marfil', 'croatia': 'croacia', 'cyprus': 'chipre',
    'czechia': 'republica checa', 'denmark': 'dinamarca', 'djibouti': 'yibuti',
    'dominican republic': 'republica dominicana', 'egypt': 'egipto', 'equatorial guinea': 'guinea ecuatorial',
    'eswatini': 'esuatini', 'ethiopia': 'etiopia', 'finland': 'finlandia', 'france': 'francia',
    'germany': 'alemania', 'greece': 'grecia', 'grenada': 'granada', 'hungary': 'hungria',
    'iceland': 'islandia', 'iraq': 'irak', 'ireland': 'irlanda', 'italy': 'italia', 'japan': 'japon',
    'jordan': 'jordania', 'kazakhstan': 'kazajistan', 'kyrgyzstan': 'kirguistan', 'laos': 'laos',
    'latvia': 'letonia', 'lebanon': 'libano', 'libya': 'libia', 'lithuania': 'lituania',
    'luxembourg': 'luxemburgo', 'macau': 'macao', 'malaysia': 'malasia', 'maldives': 'maldivas',
    'marshall islands': 'islas marshall', 'mauritius': 'mauricio', 'morocco': 'marruecos',
    'myanmar (burma)': 'myanmar (birmania)', 'netherlands': 'paises bajos', 'new zealand': 'nueva zelanda',
    'north korea': 'corea del norte', 'north macedonia': 'macedonia del norte', 'norway': 'noruega',
    'papua new guinea': 'papua nueva guinea', 'philippines': 'filipinas', 'poland': 'polonia',
    'romania': 'rumania', 'russia': 'rusia', 'saint kitts and nevis': 'san cristobal y nieves',
    'saint lucia': 'santa lucia', 'saint vincent and the grenadines': 'san vicente y las granadinas',
    'sao tome and principe': 'santo tome y principe', 'saudi arabia': 'arabia saudita',
    'sierra leone': 'sierra leona', 'singapore': 'singapur', 'slovakia': 'eslovaquia',
    'slovenia': 'eslovenia', 'solomon islands': 'islas salomon', 'south africa': 'sudafrica',
    'south korea': 'corea del sur', 'south sudan': 'sudan del sur', 'spain': 'espana',
    'sri lanka': 'sri lanka', 'sweden': 'suecia', 'switzerland': 'suiza', 'syria': 'siria',
    'tajikistan': 'tayikistan', 'thailand': 'tailandia', 'timor-leste': 'timor oriental',
    'trinidad and tobago': 'trinidad y tobago', 'tunisia': 'tunez', 'turkey': 'turquia',
    'ukraine': 'ucrania', 'united arab emirates': 'emiratos arabes unidos',
    'united kingdom': 'reino unido', 'vietnam': 'vietnam'
};

function nombreEsExtra(nombrePais) {
    return NOMBRES_ES[normalizarTexto(nombrePais)] || '';
}

function coincideBusqueda(nombrePais, q) {
    var n = normalizarTexto(nombrePais);
    return n.indexOf(q) !== -1 || nombreEsExtra(nombrePais).indexOf(q) !== -1;
}

function aplicarBusquedaRiesgos() {
    var q = normalizarTexto(document.getElementById('risk-search').value);
    var filtrados = q ? ultimosRiesgos.filter(function (p) { return coincideBusqueda(p.country, q); }) : ultimosRiesgos;
    renderRisks(filtrados);
}

function aplicarBusquedaGuerras() {
    var q = normalizarTexto(document.getElementById('war-search').value);
    var filtrados = q ? ultimasGuerras.filter(function (p) {
        return coincideBusqueda(p.pais, q) || normalizarTexto(p.lugar).indexOf(q) !== -1;
    }) : ultimasGuerras;
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
        const response = await fetch(API_WAR_REPORTS);
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const data = await response.json();
        if (!data || !Array.isArray(data.eventos)) throw new Error('Formato de datos inválido');

        if (data.fuente && data.fuente.nombre && data.fuente.url) fuenteGuerra = data.fuente;

        ultimasGuerras = data.eventos.filter(isValidWarReport);
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
