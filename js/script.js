document.addEventListener('DOMContentLoaded', () => {
    fetchPokemonList();
    fetchPokemonTypes();
    document.getElementById('searchInput').addEventListener('input', filterPokemonList);
    document.querySelector('.close').addEventListener('click', () => {
        document.getElementById('pokemonModal').style.display = 'none';
    });
    window.addEventListener('click', (event) => {
        if (event.target == document.getElementById('pokemonModal')) {
            document.getElementById('pokemonModal').style.display = 'none';
        }
    });
});

async function fetchPokemonList() {
    try {
        const response = await fetch('https://pokeapi.co/api/v2/pokemon?limit=151');
        const data = await response.json();
        const promises = data.results.map(pokemon => fetchPokemonData(pokemon.url));
        const pokemons = await Promise.all(promises);
        displayPokemonList(pokemons);
    } catch (error) {
        console.error('Error fetching Pokémon list:', error);
    }
}

async function fetchPokemonTypes() {
    try {
        const response = await fetch('https://pokeapi.co/api/v2/type');
        const data = await response.json();
        const types = data.results.map(type => type.name);
        displayPokemonTypes(types);
    } catch (error) {
        console.error('Error fetching Pokémon types:', error);
    }
}

async function fetchPokemonData(url) {
    try {
        const response = await fetch(url);
        const data = await response.json();
        const speciesResponse = await fetch(data.species.url);
        const speciesData = await speciesResponse.json();
        const species = {
            habitat: speciesData.habitat ? speciesData.habitat.name : 'Unknown',
            color: speciesData.color ? speciesData.color.name : 'Unknown'
        };
        return {
            name: data.name,
            id: data.id,
            height: data.height,
            weight: data.weight,
            types: data.types.map(type => type.type.name),
            species: species
        };
    } catch (error) {
        console.error('Error fetching Pokémon data:', error);
    }
}

let allPokemons = [];

function displayPokemonList(pokemons) {
    allPokemons = pokemons;
    const pokemonList = document.getElementById('pokemonList');
    pokemonList.innerHTML = '';
    pokemons.forEach(pokemon => {
        const pokemonItem = document.createElement('div');
        pokemonItem.classList.add('pokemon-item');
        pokemonItem.classList.add(getHabitatClass(pokemon.species.habitat)); // Agregar la clase de hábitat
        pokemonItem.dataset.name = pokemon.name.toLowerCase();
        pokemonItem.dataset.id = pokemon.id;
        pokemonItem.innerHTML = `
            <img src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${pokemon.id}.png" alt="${pokemon.name}">
            <p>${capitalizeFirstLetter(pokemon.name)} (ID: ${pokemon.id})</p>
        `;
        pokemonItem.addEventListener('click', () => {
            showPokemonDetails(pokemon);
            showPokemonData(pokemon); // Mostrar también los datos del Pokémon
        });
        pokemonList.appendChild(pokemonItem);
    });
}

function displayPokemonTypes(types) {
    const pokemonTypes = document.getElementById('pokemonTypes');
    pokemonTypes.innerHTML = '';
    types.forEach(type => {
        const typeItem = document.createElement('div');
        typeItem.textContent = type;
        pokemonTypes.appendChild(typeItem);
    });
}

function filterPokemonList() {
    const query = document.getElementById('searchInput').value.toLowerCase();
    const filteredPokemons = allPokemons.filter(pokemon => pokemon.name.includes(query));
    displayPokemonList(filteredPokemons);
}

function showPokemonDetails(pokemon) {
    const modal = document.getElementById('pokemonModal');
    modal.querySelector('#modalPokemonName').textContent = capitalizeFirstLetter(pokemon.name);
    modal.querySelector('#modalPokemonImage').src = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${pokemon.id}.png`;
    modal.querySelector('#modalPokemonDetails').innerHTML = `
        ID: ${pokemon.id} <br>
        Height: ${pokemon.height} <br>
        Weight: ${pokemon.weight} <br>
        Types: ${pokemon.types.join(', ')} <br>
        Habitat: ${pokemon.species.habitat} <br>
        Color: ${pokemon.species.color}
    `;
    modal.style.display = 'flex';
}

function showPokemonData(pokemon) {
    const pokemonData = document.getElementById('pokemonData');
    pokemonData.innerHTML = `
        <h2>${capitalizeFirstLetter(pokemon.name)}</h2>
        <p>ID: ${pokemon.id}</p>
        <p>Height: ${pokemon.height}</p>
        <p>Weight: ${pokemon.weight}</p>
        <p>Types: ${pokemon.types.join(', ')}</p>
        <p>Habitat: ${pokemon.species.habitat}</p>
        <p>Color: ${pokemon.species.color}</p>
    `;
}

function capitalizeFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

function getHabitatClass(habitat) {
    switch (habitat) {
        case 'cave':
            return 'pokemon-habitat-cave';
        case 'forest':
            return 'pokemon-habitat-forest';
        case 'grassland':
            return 'pokemon-habitat-grassland';
        case 'mountain':
            return 'pokemon-habitat-mountain';
        case 'rare':
            return 'pokemon-habitat-rare';
        case 'rough-terrain':
            return 'pokemon-habitat-rough-terrain';
        case 'sea':
            return 'pokemon-habitat-sea';
        case 'urban':
            return 'pokemon-habitat-urban';
        default:
            return 'pokemon-habitat-other';
    }
}
