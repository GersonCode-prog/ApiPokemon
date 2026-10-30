'use strict';

/* =========================================
   Configuración
   ========================================= */
const API_URL = 'https://pokeapi.co/api/v2';
const SPRITE_URL = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon';
const CACHE_KEY = 'pokedex-index-v2';
const OLD_CACHE_KEYS = ['pokedex-kanto-v1'];
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;   // 7 días
const MAX_STAT = 255;
const SKELETON_COUNT = 24;

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

const REGION_NAMES = {
    kanto: 'Kanto', johto: 'Johto', hoenn: 'Hoenn', sinnoh: 'Sinnoh',
    unova: 'Teselia', kalos: 'Kalos', alola: 'Alola', galar: 'Galar', paldea: 'Paldea'
};

// Nombres que no se pueden armar solo cambiando guiones por espacios
const SPECIAL_NAMES = {
    'nidoran-f': 'Nidoran ♀', 'nidoran-m': 'Nidoran ♂',
    'mr-mime': 'Mr. Mime', 'mime-jr': 'Mime Jr.', 'mr-rime': 'Mr. Rime',
    'farfetchd': "Farfetch'd", 'sirfetchd': "Sirfetch'd",
    'type-null': 'Type: Null', 'flabebe': 'Flabébé',
    'ho-oh': 'Ho-Oh', 'porygon-z': 'Porygon-Z',
    'jangmo-o': 'Jangmo-o', 'hakamo-o': 'Hakamo-o', 'kommo-o': 'Kommo-o',
    'wo-chien': 'Wo-Chien', 'chien-pao': 'Chien-Pao', 'ting-lu': 'Ting-Lu', 'chi-yu': 'Chi-Yu'
};

/* =========================================
   Estado
   ========================================= */
const state = {
    pokemons: [],
    byId: new Map(),
    cards: new Map(),
    details: new Map(),     // detalles cargados bajo demanda (id → Promise)
    generations: [],
    query: '',
    type: 'all',
    gen: 'all',
    currentId: null
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
        genFilter: document.getElementById('genFilter'),
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

    els.search.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            state.query = els.search.value.trim().toLowerCase();
            applyFilters();
        }, 150);
    });

    els.genFilter.addEventListener('change', () => {
        state.gen = els.genFilter.value;
        applyFilters();
    });

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
        if (event.key === 'Tab') {
            event.preventDefault();
            els.close.focus();
        }
    });

    loadPokedex();
}

/* =========================================
   Carga del índice
   En vez de pedir cada Pokémon (2 peticiones × 1000+), se arma el índice
   con los endpoints agrupados: especies, tipos, generaciones y hábitats.
   Son ~40 peticiones en total. Los detalles se piden al abrir el modal.
   ========================================= */
async function loadPokedex() {
    cleanOldCache();

    const cached = readCache();
    if (cached) {
        setupData(cached);
        return;
    }

    renderSkeletons(SKELETON_COUNT);
    setStatus('Cargando la Pokédex…');

    try {
        const index = await fetchIndex();
        writeCache(index);
        removeSkeletons();
        setupData(index);
    } catch (error) {
        console.error('Error cargando la Pokédex:', error);
        removeSkeletons();
        setStatus('No se pudo cargar la Pokédex. Revisa tu conexión y recarga la página.');
    }
}

async function fetchIndex() {
    const [speciesList, typeList, genList, habitatList] = await Promise.all([
        getJSON(`${API_URL}/pokemon-species?limit=100000`),
        getJSON(`${API_URL}/type?limit=100`),
        getJSON(`${API_URL}/generation?limit=100`),
        getJSON(`${API_URL}/pokemon-habitat?limit=100`)
    ]);

    // Se omiten tipos especiales sin Pokémon (unknown, shadow, stellar…)
    const types = typeList.results.filter((type) => TYPE_NAMES[type.name]);

    const [typeData, genData, habitatData] = await Promise.all([
        Promise.all(types.map((type) => getJSON(type.url))),
        Promise.all(genList.results.map((gen) => getJSON(gen.url))),
        Promise.all(habitatList.results.map((habitat) => getJSON(habitat.url)))
    ]);

    const pokemons = new Map();

    speciesList.results.forEach((species) => {
        const id = getIdFromUrl(species.url);
        pokemons.set(id, { id: id, name: species.name, types: [], habitat: 'unknown', gen: 0 });
    });

    // Tipos: el endpoint /type/{x} trae todos los Pokémon de ese tipo con su "slot"
    // (Las formas alternas tienen id > 10000 y no coinciden con ninguna especie: se ignoran)
    typeData.forEach((type) => {
        type.pokemon.forEach((entry) => {
            const pokemon = pokemons.get(getIdFromUrl(entry.pokemon.url));
            if (pokemon) pokemon.types[entry.slot - 1] = type.name;
        });
    });

    habitatData.forEach((habitat) => {
        habitat.pokemon_species.forEach((species) => {
            const pokemon = pokemons.get(getIdFromUrl(species.url));
            if (pokemon) pokemon.habitat = habitat.name;
        });
    });

    const generations = genData
        .map((gen) => {
            gen.pokemon_species.forEach((species) => {
                const pokemon = pokemons.get(getIdFromUrl(species.url));
                if (pokemon) pokemon.gen = gen.id;
            });
            const roman = gen.name.split('-')[1].toUpperCase();
            const region = gen.main_region ? gen.main_region.name : '';
            return {
                id: gen.id,
                label: `Gen ${roman}${region ? ' · ' + (REGION_NAMES[region] || capitalize(region)) : ''}`
            };
        })
        .sort((a, b) => a.id - b.id);

    const list = Array.from(pokemons.values())
        .map((pokemon) => Object.assign(pokemon, { types: pokemon.types.filter(Boolean) }))
        .sort((a, b) => a.id - b.id);

    return { pokemons: list, generations: generations };
}

function setupData(index) {
    state.generations = index.generations;
    addPokemons(index.pokemons);
    renderGenerationFilter();
    renderTypeFilters();
    applyFilters();
}

/* =========================================
   Detalles (bajo demanda, al abrir el modal)
   ========================================= */
function getDetails(id) {
    if (!state.details.has(id)) {
        const promise = Promise.all([
            getJSON(`${API_URL}/pokemon/${id}`),
            getJSON(`${API_URL}/pokemon-species/${id}`)
        ]).then(([data, species]) => ({
            height: data.height / 10,   // decímetros → metros
            weight: data.weight / 10,   // hectogramos → kg
            color: species.color ? species.color.name : 'unknown',
            stats: data.stats.map((s) => ({ name: s.stat.name, value: s.base_stat })),
            genus: pickLanguage(species.genera, 'genus'),
            flavor: pickLanguage(species.flavor_text_entries, 'flavor_text')
        }));

        // Si falla, se borra para poder reintentar al volver a abrir
        promise.catch(() => state.details.delete(id));
        state.details.set(id, promise);
    }
    return state.details.get(id);
}

async function getJSON(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status} en ${url}`);
    return response.json();
}

function pickLanguage(entries, field) {
    if (!entries || !entries.length) return '';
    const entry = entries.find((e) => e.language.name === 'es')
               || entries.find((e) => e.language.name === 'en');
    return entry ? entry[field].replace(/[\n\f\r\u00ad]+/g, ' ').trim() : '';
}

/* =========================================
   Caché local del índice
   ========================================= */
function readCache() {
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        const cache = JSON.parse(raw);
        const fresh = Date.now() - cache.savedAt < CACHE_TTL;
        return fresh && cache.data && Array.isArray(cache.data.pokemons) && cache.data.pokemons.length
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
        // Almacenamiento lleno o bloqueado: solo no se cachea
    }
}

function cleanOldCache() {
    try {
        OLD_CACHE_KEYS.forEach((key) => localStorage.removeItem(key));
    } catch (error) {
        // ignorar
    }
}

/* =========================================
   Render de la lista
   ========================================= */
function addPokemons(pokemons) {
    const fragment = document.createDocumentFragment();

    pokemons.forEach((pokemon) => {
        pokemon.displayName = getDisplayName(pokemon.name);
        pokemon.searchText = `${pokemon.name} ${pokemon.displayName.toLowerCase()}`;

        state.pokemons.push(pokemon);
        state.byId.set(pokemon.id, pokemon);

        const card = createCard(pokemon);
        state.cards.set(pokemon.id, card);
        fragment.appendChild(card);
    });

    els.list.appendChild(fragment);
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
    img.src = spriteUrl(pokemon.id);
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.width = 96;
    img.height = 96;
    // Si no existe el sprite pequeño, usar la ilustración oficial
    img.addEventListener('error', () => {
        img.src = artworkUrl(pokemon.id);
    }, { once: true });

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

function removeSkeletons() {
    els.list.querySelectorAll('.skeleton').forEach((skeleton) => skeleton.remove());
}

/* =========================================
   Filtros
   ========================================= */
function renderGenerationFilter() {
    els.genFilter.replaceChildren(new Option('Todas las generaciones', 'all'));
    state.generations.forEach((gen) => {
        els.genFilter.appendChild(new Option(gen.label, String(gen.id)));
    });
    els.genFilter.value = state.gen;
}

function renderTypeFilters() {
    const present = new Set(state.pokemons.flatMap((p) => p.types));
    const types = Object.keys(TYPE_NAMES).filter((type) => present.has(type));

    els.filters.replaceChildren(createFilterButton('all', 'Todos', 'chip-all'));
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
    const query = state.query.replace(/^#0*/, '');
    const isNumber = /^\d+$/.test(query);
    const gen = state.gen === 'all' ? null : Number(state.gen);
    let visible = 0;

    state.pokemons.forEach((pokemon) => {
        const matchesQuery = !query
            || pokemon.searchText.includes(query)
            || (isNumber && pokemon.id === Number(query));
        const matchesType = state.type === 'all' || pokemon.types.includes(state.type);
        const matchesGen = gen === null || pokemon.gen === gen;
        const show = matchesQuery && matchesType && matchesGen;

        state.cards.get(pokemon.id).hidden = !show;
        if (show) visible++;
    });

    els.empty.hidden = visible > 0 || state.pokemons.length === 0;
    setStatus(`Mostrando ${visible.toLocaleString('es')} de ${state.pokemons.length.toLocaleString('es')} Pokémon`);
}

/* =========================================
   Modal
   ========================================= */
async function openModal(id) {
    const pokemon = state.byId.get(id);
    if (!pokemon) return;

    state.currentId = id;
    lastFocused = document.activeElement;

    // Lo que ya tenemos se muestra al instante
    els.header.className = `modal-header habitat-${pokemon.habitat}`;
    els.image.onerror = () => {
        els.image.onerror = null;
        els.image.src = spriteUrl(id);
    };
    els.image.src = artworkUrl(id);
    els.image.alt = `Ilustración de ${pokemon.displayName}`;
    els.number.textContent = formatNumber(id);
    els.name.textContent = pokemon.displayName;
    els.types.replaceChildren(...createTypeBadges(pokemon.types).children);
    els.flavor.hidden = true;
    els.details.replaceChildren();
    els.stats.replaceChildren(createLoadingText('Cargando detalles…'));

    els.modal.hidden = false;
    document.body.classList.add('modal-open');
    els.close.focus();

    // Los detalles se piden ahora (y quedan en memoria para la próxima vez)
    try {
        const details = await getDetails(id);
        if (state.currentId !== id) return;   // el usuario ya abrió otro o cerró
        renderDetails(pokemon, details);
    } catch (error) {
        console.error(`Error cargando detalles de #${id}:`, error);
        if (state.currentId === id) {
            els.stats.replaceChildren(createLoadingText('No se pudieron cargar los detalles. Intenta de nuevo.'));
        }
    }
}

function renderDetails(pokemon, details) {
    if (details.genus) {
        els.number.textContent = `${formatNumber(pokemon.id)} · ${details.genus}`;
    }

    els.flavor.textContent = details.flavor;
    els.flavor.hidden = !details.flavor;

    const gen = state.generations.find((g) => g.id === pokemon.gen);

    els.details.replaceChildren(
        createDetail('Altura', `${details.height.toFixed(1)} m`),
        createDetail('Peso', `${details.weight.toFixed(1)} kg`),
        createDetail('Generación', gen ? gen.label : '—'),
        createDetail('Color', COLOR_NAMES[details.color] || capitalize(details.color)),
        createDetail('Hábitat', HABITAT_NAMES[pokemon.habitat] || capitalize(pokemon.habitat))
    );

    const total = details.stats.reduce((sum, stat) => sum + stat.value, 0);
    els.stats.replaceChildren(
        ...details.stats.map(createStatRow),
        createTotalRow(total)
    );
}

function closeModal() {
    state.currentId = null;
    els.modal.hidden = true;
    document.body.classList.remove('modal-open');
    if (lastFocused) lastFocused.focus();
}

function createLoadingText(text) {
    const p = document.createElement('p');
    p.className = 'loading-text';
    p.textContent = text;
    return p;
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

function getIdFromUrl(url) {
    return Number(url.split('/').filter(Boolean).pop());
}

function spriteUrl(id) {
    return `${SPRITE_URL}/${id}.png`;
}

function artworkUrl(id) {
    return `${SPRITE_URL}/other/official-artwork/${id}.png`;
}

function formatNumber(id) {
    return `#${String(id).padStart(4, '0')}`;
}

function capitalize(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function getDisplayName(name) {
    if (SPECIAL_NAMES[name]) return SPECIAL_NAMES[name];
    // "tapu-koko" → "Tapu Koko", "iron-valiant" → "Iron Valiant"
    return name.split('-').map(capitalize).join(' ');
}
