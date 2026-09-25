// SEARCH & REVERSE GEOCODING (NOMINATIM)
// Search input with debounced requests to Nominatim.
// Reverse geocode on map move to update city/country labels.
// Keyboard navigation in search results.
// -----------------------------------------------------------------------------
    // Search and reverse geocoding via Nominatim
    const searchInput = document.getElementById('searchInput');
    const searchResults = document.getElementById('searchResults');
    const cityNameEl = document.getElementById('cityName');
    const cityCoordsEl = document.getElementById('cityCoords');
    const cityCountryEl = document.getElementById('cityCountry');
    let debounceTimer;
    let searchController;
    let activeSearchIndex = -1;
    let lastSearchAt = 0;
    let reverseController;
    let lastReverseAt = 0;
    let locationSelectionInProgress = false;
    const searchCache = new Map();
    const reverseCache = new Map();
    const SEARCH_INTERVAL_MS = 1000;
    const REVERSE_INTERVAL_MS = 1200;
    const statusMessage = document.getElementById('statusMessage');
    const geocoder = CartivaGeocoding.create(CartivaServices.geocoder);

    function setStatus(message, isError = false) {
      statusMessage.textContent = message;
      statusMessage.classList.toggle('error', isError);
      const dialogProgress = document.getElementById('exportDialogProgress');
      if (dialogProgress) {
        dialogProgress.textContent = message;
        dialogProgress.classList.toggle('error', isError);
      }
    }

    function setSearchResultsVisible(visible) {
      searchResults.style.display = visible ? 'block' : 'none';
      searchInput.setAttribute('aria-expanded', String(visible));
    }

    function showSearchMessage(message) {
      searchResults.innerHTML = `<div class="search-message">${message}</div>`;
      setSearchResultsVisible(true);
      activeSearchIndex = -1;
    }

    function selectSearchResult(item) {
      const lat = Number(item.lat);
      const lon = Number(item.lon);
      map.flyTo({ center: [lon, lat], zoom: 12 });
      locationSelectionInProgress = true;
      cityNameEl.textContent = item.display_name.split(',')[0].toUpperCase();
      searchInput.value = item.display_name.split(',')[0];
      if (item.address?.country) cityCountryEl.textContent = item.address.country.toUpperCase();
      else updateLocationFromCenter();
      setSearchResultsVisible(false);
      setStatus('');
      syncStateFromControls();
      saveLastLocation();
      CartivaDiagnostics.record('geocoder.selection', 'Location selected.', { name: item.display_name, center: [lon, lat] });
    }

    function renderSearchResults(data) {
      searchResults.innerHTML = '';
      activeSearchIndex = -1;
      const uniqueResults = [...new Map(data.map(item => [
        item.display_name.trim().replace(/\s+/g, ' ').toLocaleLowerCase(),
        item
      ])).values()];
      uniqueResults.forEach(item => {
        const div = document.createElement('div');
        div.className = 'search-item';
        div.setAttribute('role', 'option');
        div.setAttribute('aria-selected', 'false');
        div.textContent = item.display_name;
        div.addEventListener('click', () => selectSearchResult(item));
        searchResults.appendChild(div);
      });
      setSearchResultsVisible(true);
    }

    function updateCoordsDisplay() {
      const center = map.getCenter();
      const lat = center.lat.toFixed(4);
      const lng = center.lng.toFixed(4);
      cityCoordsEl.textContent = `${Math.abs(lat)}° ${lat >= 0 ? 'N' : 'S'} / ${Math.abs(lng)}° ${lng >= 0 ? 'E' : 'W'}`;
    }

    map.on('move', updateCoordsDisplay);

    function getNearestCity(address) {
      return address.city
        || address.town
        || address.municipality
        || address.village
        || address.county
        || address.state;
    }

    async function updateLocationFromCenter() {
      const center = map.getCenter();
      const cacheKey = `${center.lat.toFixed(3)},${center.lng.toFixed(3)}`;
      reverseController?.abort();
      try {
        const cached = reverseCache.get(cacheKey);
        const waitMs = Math.max(0, REVERSE_INTERVAL_MS - (Date.now() - lastReverseAt));
        if (!cached && waitMs) await new Promise(resolve => setTimeout(resolve, waitMs));
        reverseController = new AbortController();
        lastReverseAt = Date.now();
        const data = cached || await geocoder.reverse({ lat: center.lat, lon: center.lng }, reverseController.signal);
        if (!cached) reverseCache.set(cacheKey, data);
        const city = getNearestCity(data.address || {});
        if (city) {
          cityNameEl.textContent = city.toUpperCase();
          searchInput.value = city;
        }
        if (data.address?.country) cityCountryEl.textContent = data.address.country.toUpperCase();
        syncStateFromControls();
        saveLastLocation();
      } catch (error) {
        if (error.name !== 'AbortError') {
          setStatus(`Location update failed: ${error.message}`, true);
        }
      }
    }

    map.on('moveend', () => {
      if (locationSelectionInProgress) {
        locationSelectionInProgress = false;
        syncStateFromControls();
        return;
      }
      updateLocationFromCenter();
    });

    function requestLocationSearch() {
      clearTimeout(debounceTimer);
      const query = searchInput.value.trim();
      searchController?.abort();
      if (query.length < 3) {
        setSearchResultsVisible(false);
        return;
      }

      const runSearch = async () => {
        searchController = new AbortController();
        try {
          showSearchMessage('Loading locations...');
          setStatus('Searching...');
          CartivaDiagnostics.record('geocoder.search', 'Location search started.', { query });
          const cached = searchCache.get(query.toLowerCase());
          if (cached) {
            renderSearchResults(cached);
            setStatus('');
            return;
          }
          const waitMs = Math.max(0, SEARCH_INTERVAL_MS - (Date.now() - lastSearchAt));
          if (waitMs) await new Promise(resolve => setTimeout(resolve, waitMs));
          lastSearchAt = Date.now();
          const data = await geocoder.search(query, searchController.signal);
          searchCache.set(query.toLowerCase(), data);
          if (!data.length) {
            showSearchMessage('No locations found.');
            setStatus('No locations found.');
            return;
          }
          renderSearchResults(data);
          CartivaDiagnostics.record('geocoder.search', 'Location search completed.', { query, resultCount: data.length });
          setStatus('');
        } catch (error) {
          if (error.name !== 'AbortError') {
            setSearchResultsVisible(false);
            setStatus(`Location search failed: ${error.message}`, true);
          }
        }
      };
      debounceTimer = setTimeout(runSearch, 300);
    }

    searchInput.addEventListener('input', requestLocationSearch);
    $('searchBtn').addEventListener('click', requestLocationSearch);

    searchInput.addEventListener('keydown', event => {
      const items = [...searchResults.querySelectorAll('.search-item')];
      if (!items.length) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        activeSearchIndex = event.key === 'ArrowDown'
          ? (activeSearchIndex + 1) % items.length
          : (activeSearchIndex - 1 + items.length) % items.length;
        items.forEach((item, index) => {
          item.classList.toggle('active', index === activeSearchIndex);
          item.setAttribute('aria-selected', String(index === activeSearchIndex));
        });
        items[activeSearchIndex].scrollIntoView({ block: 'nearest' });
      } else if (event.key === 'Enter' && activeSearchIndex >= 0) {
        event.preventDefault();
        items[activeSearchIndex].click();
      } else if (event.key === 'Escape') {
        setSearchResultsVisible(false);
      }
    });

    document.addEventListener('click', (e) => {
      if (!searchInput.contains(e.target) && !searchResults.contains(e.target)) {
        setSearchResultsVisible(false);
      }
    });


// -----------------------------------------------------------------------------