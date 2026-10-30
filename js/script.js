'use strict';

/* =========================================
   Configuración
   ========================================= */
const API_URL = 'https://pokeapi.co/api/v2';
const TOTAL_POKEMON = 151;
const BATCH_SIZE = 20;                       // peticiones en paralelo por lote
const CACHE_KEY = 'pokedex-kanto-v1';
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;   // 7 días
const MAX_STAT = 255;

const TYPE_NAMES = {
    normal: 'Normal', fire: 'Fuego', water: 'Agua', grass: 'Planta',
    electric: 'Eléctrico', ice: 'Hielo', fighting: 'Lucha', poison: 'Veneno',
    ground: 'Tierra', flying: 'Volador', psychic: 'Psíquico', bug: 'Bicho',
    rock: 'Roca', ghost: 'Fantasma', dragon: 'Dragón', dark: 'Siniestro',
    steel: 'Acero', fairy: 'Hada'
};

const HABITAT_NAMES = {
    cave: 'Cueva', forest: 'Bosque', grassland: 'Pradera', mountain: 'Montaña',
    rare: 'Raro', 'rough-terrain': 'Terreno agreste', sea: 'Mar', urban: 'Urbano',
    'waters-edge': 'Orilla del agua', unknown: 'Desconocido'
};

const COLOR_NAMES = {
    black: 'Negro', blue: 'Azul', brown: 'Café', gray: 'Gris', green: 'Verde',
    pink: 'Rosa', purple: 'Morado', red: 'Rojo', white: 'Blanco',
    yellow: 'Amarillo', unknown: 'Desconocido'
};

const STAT_NAMES = {
    hp: 'PS', attack: 'Ataque', defense: 'Defensa',
    'special-attack': 'At. Esp.', 'special-defense': 'Def. Esp.', speed: 'Velocidad'
};

// Nombres que la API devuelve "feos"
const SPECIAL_NAMES = {
    'nidoran-f': 'Nidoran ♀',
    'nidoran-m': 'Nidoran ♂',
    'mr-mime': 'Mr. Mime',
    'farfetchd': "Farfetch'd"
};

/* =========================================
   Estado
   ========================================= */
const state = {
    pokemons: [],
    byId: new Map(),
    cards: new Map(),
    query: '',
    type: 'all'
};

let els = null;
let lastFocused = null;
let searchTimer = null;

document.addEventListener('DOMContentLoaded', init);

/* =========================================
   Inicialización
   ========================================= */
function init() {
    const modal = document.getElementById('pokemonModal');

    els = {
        search: document.getElementById('searchInput'),
        list: document.getElementById('pokemonList'),
        empty: document.getElementById('emptyState'),
        status: document.getElementById('status'),
        filters: document.getElementById('typeFilters'),
        modal: modal,
        close: modal.querySelector('.close'),
        header: document.getElementById('modalHeader'),
        image: document.getElementById('modalPokemonImage'),
        number: document.getElementById('modalPokemonNumber'),
        name: document.getElementById('modalPokemonName'),
        types: document.getElementById('modalPokemonTypes'),
        flavor: document.getElementById('modalPokemonFlavor'),
        details: document.getElementById('modalPokemonDetails'),
        stats: document.getElementById('modalPokemonStats')
    };

    // Búsqueda con debounce
    els.search.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            state.query = els.search.value.trim().toLowerCase();
            applyFilters();
        }, 150);
    });

    // Delegación de eventos: un solo listener para todas las tarjetas
    els.list.addEventListener('click', (event) => {
        const card = event.target.closest('.pokemon-item');
        if (card) openModal(Number(card.dataset.id));
    });

    els.filters.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-type]');
        if (!button) return;
        state.type = button.dataset.type;
        updateFilterButtons();
        applyFilters();
    });

    els.close.addEventListener('click', closeModal);

    els.modal.addEventListener('click', (event) => {
        if (event.target === els.modal) closeModal();
    });

    document.addEventListener('keydown', (event) => {
        if (els.modal.hidden) return;
        if (event.key === 'Escape') closeModal();
        // El único elemento enfocable del modal es el botón cerrar: mantener el foco ahí
        if (event.key === 'Tab') {
            event.preventDefault();
            els.close.focus();
        }
    });

    loadPokedex();
}

/* =========================================
   Carga de datos
   ========================================= */
async function loadPokedex() {
    const cached = readCache();
    if (cached) {
        addPokemons(cached);
        finishLoading(0);
        return;
    }

    renderSkeletons(TOTAL_POKEMON);
    setStatus(`Cargando… 0 de ${TOTAL_POKEMON}`);

    let failed = 0;

    // Por lotes para no lanzar 300 peticiones a la vez
    for (let start = 1; start <= TOTAL_POKEMON; start += BATCH_SIZE) {
        const ids = range(start, Math.min(start + BATCH_SIZE - 1, TOTAL_POKEMON));
        const results = await Promise.allSettled(ids.map(fetchPokemon));
        const loaded = [];

        results.forEach((result, i) => {
            if (result.status === 'fulfilled') {
                loaded.push(result.value);
            } else {
                failed++;
                console.error(`Error cargando el Pokémon #${ids[i]}:`, result.reason);
            }
        });

        addPokemons(loaded);
        removeSkeletons(ids.length);
        setStatus(`Cargando… ${state.pokemons.length} de ${TOTAL_POKEMON}`);
    }

    if (failed === 0) writeCache(state.pokemons);
    finishLoading(failed);
}

async function fetchPokemon(id) {
    const data = await getJSON(`${API_URL}/pokemon/${id}`);
    const species = await getJSON(data.species.url);
    const other = data.sprites.other || {};
    const artwork = other['official-artwork'] ? other['official-artwork'].front_default : null;

    return {
        id: data.id,
        name: data.name,
        height: data.height / 10,   // la API da decímetros → metros
        weight: data.weight / 10,   // la API da hectogramos → kg
        types: data.types.map((t) => t.type.name),
        habitat: species.habitat ? species.habitat.name : 'unknown',
        color: species.color ? species.color.name : 'unknown',
        sprite: data.sprites.front_default,
        artwork: artwork || data.sprites.front_default,
        stats: data.stats.map((s) => ({ name: s.stat.name, value: s.base_stat })),
        genus: pickLanguage(species.genera, 'genus'),
        flavor: pickLanguage(species.flavor_text_entries, 'flavor_text')
    };
}

async function getJSON(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status} en ${url}`);
    return response.json();
}

// Busca el texto en español; si no existe, en inglés
function pickLanguage(entries, field) {
    if (!entries || !entries.length) return '';
    const entry = entries.find((e) => e.language.name === 'es')
               || entries.find((e) => e.language.name === 'en');
    return entry ? entry[field].replace(/[\n\f\r\u00ad]+/g, ' ').trim() : '';
}

function finishLoading(failed) {
    renderTypeFilters();
    applyFilters();
    setStatus(failed
        ? `No se pudieron cargar ${failed} Pokémon. Recarga la página para reintentar.`
        : '');
}

/* =========================================
   Caché local (para no descargar todo cada vez)
   ========================================= */
function readCache() {
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        const cache = JSON.parse(raw);
        const fresh = Date.now() - cache.savedAt < CACHE_TTL;
        return fresh && Array.isArray(cache.data) && cache.data.length === TOTAL_POKEMON
            ? cache.data
            : null;
    } catch (error) {
        return null;
    }
}

function writeCache(data) {
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), data: data }));
    } catch (error) {
        // Almacenamiento lleno o bloqueado: no pasa nada, solo no se cachea
    }
}

/* =========================================
   Render de la lista
   ========================================= */
function addPokemons(pokemons) {
    const fragment = document.createDocumentFragment();

    pokemons
        .sort((a, b) => a.id - b.id)
        .forEach((pokemon) => {
            pokemon.displayName = getDisplayName(pokemon.name);
            pokemon.searchText = `${pokemon.name} ${pokemon.displayName.toLowerCase()}`;

            state.pokemons.push(pokemon);
            state.byId.set(pokemon.id, pokemon);

            const card = createCard(pokemon);
            state.cards.set(pokemon.id, card);
            fragment.appendChild(card);
        });

    // Inserta antes de los skeletons (si no hay, se agrega al final)
    els.list.insertBefore(fragment, els.list.querySelector('.skeleton'));
}

function createCard(pokemon) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `pokemon-item habitat-${pokemon.habitat}`;
    card.dataset.id = pokemon.id;
    card.setAttribute('aria-label', `${pokemon.displayName}, número ${pokemon.id}`);

    const number = document.createElement('span');
    number.className = 'number';
    number.textContent = formatNumber(pokemon.id);

    const img = document.createElement('img');
    img.src = pokemon.sprite;
    img.alt = '';
    img.loading = 'lazy';
    img.width = 96;
    img.height = 96;

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = pokemon.displayName;

    card.append(number, img, name, createTypeBadges(pokemon.types));
    return card;
}

function createTypeBadges(types) {
    const wrapper = document.createElement('div');
    wrapper.className = 'types';
    types.forEach((type) => {
        const badge = document.createElement('span');
        badge.className = `type-badge type-${type}`;
        badge.textContent = TYPE_NAMES[type] || capitalize(type);
        wrapper.appendChild(badge);
    });
    return wrapper;
}

function renderSkeletons(count) {
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < count; i++) {
        const skeleton = document.createElement('div');
        skeleton.className = 'skeleton';
        skeleton.setAttribute('aria-hidden', 'true');
        fragment.appendChild(skeleton);
    }
    els.list.appendChild(fragment);
}

function removeSkeletons(count) {
    const skeletons = els.list.querySelectorAll('.skeleton');
    for (let i = 0; i < count && i < skeletons.length; i++) {
        skeletons[i].remove();
    }
}

/* =========================================
   Filtros
   ========================================= */
function renderTypeFilters() {
    // Solo los tipos que realmente existen en los Pokémon cargados
    const present = new Set(state.pokemons.flatMap((p) => p.types));
    const types = Object.keys(TYPE_NAMES).filter((type) => present.has(type));

    els.filters.replaceChildren();
    els.filters.appendChild(createFilterButton('all', 'Todos', 'chip-all'));
    types.forEach((type) => {
        els.filters.appendChild(createFilterButton(type, TYPE_NAMES[type], `type-${type}`));
    });

    updateFilterButtons();
}

function createFilterButton(type, label, extraClass) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `type-chip ${extraClass}`;
    button.dataset.type = type;
    button.textContent = label;
    return button;
}

function updateFilterButtons() {
    els.filters.querySelectorAll('button[data-type]').forEach((button) => {
        button.setAttribute('aria-pressed', String(button.dataset.type === state.type));
    });
}

function applyFilters() {
    const query = state.query.replace(/^#/, '');
    const isNumber = /^\d+$/.test(query);
    let visible = 0;

    state.pokemons.forEach((pokemon) => {
        const matchesQuery = !query
            || pokemon.searchText.includes(query)
            || (isNumber && pokemon.id === Number(query));
        const matchesType = state.type === 'all' || pokemon.types.includes(state.type);
        const show = matchesQuery && matchesType;

        state.cards.get(pokemon.id).hidden = !show;
        if (show) visible++;
    });

    // Solo mostrar "sin resultados" cuando ya hay datos cargados
    els.empty.hidden = visible > 0 || state.pokemons.length === 0;
}

/* =========================================
   Modal
   ========================================= */
function openModal(id) {
    const pokemon = state.byId.get(id);
    if (!pokemon) return;

    lastFocused = document.activeElement;

    els.header.className = `modal-header habitat-${pokemon.habitat}`;
    els.image.src = pokemon.artwork;
    els.image.alt = `Ilustración de ${pokemon.displayName}`;
    els.number.textContent = pokemon.genus
        ? `${formatNumber(pokemon.id)} · ${pokemon.genus}`
        : formatNumber(pokemon.id);
    els.name.textContent = pokemon.displayName;
    els.types.replaceChildren(...createTypeBadges(pokemon.types).children);

    els.flavor.textContent = pokemon.flavor;
    els.flavor.hidden = !pokemon.flavor;

    els.details.replaceChildren(
        createDetail('Altura', `${pokemon.height.toFixed(1)} m`),
        createDetail('Peso', `${pokemon.weight.toFixed(1)} kg`),
        createDetail('Hábitat', HABITAT_NAMES[pokemon.habitat] || capitalize(pokemon.habitat)),
        createDetail('Color', COLOR_NAMES[pokemon.color] || capitalize(pokemon.color))
    );

    const total = pokemon.stats.reduce((sum, stat) => sum + stat.value, 0);
    els.stats.replaceChildren(
        ...pokemon.stats.map(createStatRow),
        createTotalRow(total)
    );

    els.modal.hidden = false;
    document.body.classList.add('modal-open');
    els.close.focus();
}

function closeModal() {
    els.modal.hidden = true;
    document.body.classList.remove('modal-open');
    if (lastFocused) lastFocused.focus();
}

function createDetail(label, value) {
    const wrapper = document.createElement('div');
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = label;
    dd.textContent = value;
    wrapper.append(dt, dd);
    return wrapper;
}

function createStatRow(stat) {
    const row = document.createElement('div');
    const level = stat.value < 50 ? 'stat-low' : stat.value < 90 ? 'stat-mid' : 'stat-high';
    row.className = `stat ${level}`;

    const name = document.createElement('span');
    name.className = 'stat-name';
    name.textContent = STAT_NAMES[stat.name] || stat.name;

    const value = document.createElement('span');
    value.className = 'stat-value';
    value.textContent = stat.value;

    const bar = document.createElement('div');
    bar.className = 'stat-bar';
    const fill = document.createElement('div');
    fill.className = 'stat-fill';
    fill.style.width = `${Math.min(100, (stat.value / MAX_STAT) * 100)}%`;
    bar.appendChild(fill);

    row.append(name, value, bar);
    return row;
}

function createTotalRow(total) {
    const row = document.createElement('div');
    row.className = 'stat stat-total';

    const name = document.createElement('span');
    name.className = 'stat-name';
    name.textContent = 'Total';

    const value = document.createElement('span');
    value.className = 'stat-value';
    value.textContent = total;

    row.append(name, value);
    return row;
}

/* =========================================
   Utilidades
   ========================================= */
function setStatus(message) {
    els.status.textContent = message;
}

function range(from, to) {
    const result = [];
    for (let i = from; i <= to; i++) result.push(i);
    return result;
}

function formatNumber(id) {
    return `#${String(id).padStart(3, '0')}`;
}

function capitalize(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function getDisplayName(name) {
    return SPECIAL_NAMES[name] || capitalize(name);
}
