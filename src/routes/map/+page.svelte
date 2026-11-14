
<script>
	import { onMount } from 'svelte';
	import 'leaflet/dist/leaflet.css';
	import { goto } from '$app/navigation';

	let L;
	let mapElement;
	let map;
	let districtLayer;

	let selectedDistrict = $state(null);
	let chamber = $state('senate');

	const files = {
		senate: '/geo/senate-districts.geojson',
		house: '/geo/house-districts.geojson'
	};

	async function loadDistricts(selectedChamber = chamber) {
		if (!map || !L) return;

		if (districtLayer) {
			map.removeLayer(districtLayer);
			districtLayer = null;
		}

		selectedDistrict = null;

		try {
			const response = await fetch(files[selectedChamber]);

			if (!response.ok) {
				throw new Error(`GeoJSON request failed: ${response.status}`);
			}

			const geojson = await response.json();

			console.log('GeoJSON feature count:', geojson.features?.length);
			console.log('First feature:', geojson.features?.[0]);
			console.log('First coordinates:', geojson.features?.[0]?.geometry?.coordinates?.[0]?.[0]);

			if (!geojson.features?.length) {
				throw new Error('No district features found in GeoJSON.');
			}

			districtLayer = L.geoJSON(geojson, {
				style: {
					color: '#2563eb',
					weight: 2,
					fillColor: '#60a5fa',
					fillOpacity: 0.35
				},

				onEachFeature: (feature, layer) => {
					const properties = feature.properties || {};

					const districtNumber =
						selectedChamber === 'senate' ? properties.Sen_ID : properties.House_ID;

					const districtName =
						selectedChamber === 'senate' ? properties.Sen_Name : properties.House_Name;

					layer.bindTooltip(districtName || `District ${districtNumber ?? 'Unknown'}`);

					layer.on('click', () => {
						selectedDistrict = {
							number: districtNumber,
							name: districtName,
							chamber: selectedChamber,
							properties
						};

						districtLayer.setStyle({
							color: '#2563eb',
							weight: 2,
							fillOpacity: 0.35
						});

						layer.setStyle({
							color: '#f59e0b',
							weight: 4,
							fillColor: '#fbbf24',
							fillOpacity: 0.5
						});
					});
				}
			}).addTo(map);

			const bounds = districtLayer.getBounds();

			console.log('District bounds:', bounds.toBBoxString());

			if (bounds.isValid()) {
				map.invalidateSize();
				map.fitBounds(bounds, {
					padding: [30, 30],
					maxZoom: 10
				});
			} else {
				console.error('Invalid district boundaries.');
			}
		} catch (error) {
			console.error('District loading error:', error);
		}
	}

	function selectDistrict() {
		if (!selectedDistrict) return;

		const message = `Tell me about ${selectedDistrict.chamber} district ${selectedDistrict.number}.`;
		goto("./?query=" + encodeURIComponent(message));
	}

	onMount(async () => {
		try {
			const leaflet = await import('leaflet');

			L = leaflet.default ?? leaflet;

			map = L.map(mapElement, {
				zoomControl: false,
				scrollWheelZoom: true,
				touchZoom: true,
				doubleClickZoom: true
			}).setView([21.45, -157.95], 9);

			L.control.zoom({
				position: 'topright'
			}).addTo(map);

			L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
				attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
			}).addTo(map);

			await loadDistricts('senate');
		} catch (error) {
			console.error('Failed to initialize Leaflet:', error);
		}

		return () => {
			map?.remove();
			map = null;
		};
	});

	$effect(() => {
		const currentChamber = chamber;

		if (map && L) {
			loadDistricts(currentChamber);
		}
	});
</script>

<div class="district-explorer">
	<header>
		<div>
			<h2>Explore Legislative Districts</h2>
			<p>Select a district on the map to explore its profile.</p>
		</div>

		<select bind:value={chamber} aria-label="Select chamber">
			<option value="senate">Senate Districts</option>
			<option value="house">House Districts</option>
		</select>
	</header>

	<div class="map" bind:this={mapElement}></div>

	{#if selectedDistrict}
		<article class="district-info">
			<div>
				<small>Selected District</small>
				<h3>
					{selectedDistrict.chamber === 'senate' ? 'Senate' : 'House'}
					District {selectedDistrict.number}
				</h3>
			</div>

			<button onclick={selectDistrict}>
				Ask Arthur about this district
			</button>
		</article>
	{:else}
		<p class="hint">Click a district to see more information.</p>
	{/if}
</div>

<style>
	.district-explorer {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 1rem 5rem;
	}

	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
	}

	header h2 {
		margin-bottom: 0.25rem;
	}

	header p {
		margin-bottom: 0;
		color: var(--pico-muted-color);
	}

	header select {
		width: auto;
		margin: 0;
	}

	.map {
		width: 100%;
		height: 550px;
		border-radius: 12px;
		overflow: hidden;
		z-index: 0;
	}

	/* Zoom control container */
	:global(.leaflet-control-zoom) {
		display: flex !important;
		flex-direction: column !important;
		align-items: center !important;
		justify-content: center !important;

		width: 40px !important;
		height: auto !important;

		margin: 10px !important;
		padding: 0 !important;

		border: 1px solid #d1d5db !important;
		border-radius: 8px !important;
		overflow: hidden !important;

		background: white !important;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15) !important;
	}

	/* Both zoom buttons */
	:global(.leaflet-control-zoom a) {
		display: flex !important;
		align-items: center !important;
		justify-content: center !important;

		box-sizing: border-box !important;
		width: 38px !important;
		height: 38px !important;
		min-height: 38px !important;

		margin: 0 !important;
		padding: 0 !important;

		border: none !important;
		border-radius: 0 !important;
		background: white !important;
		color: #333 !important;

		font-family: Arial, sans-serif !important;
		font-size: 0 !important;
		font-weight: normal !important;
		line-height: 1 !important;
		text-align: center !important;
		text-indent: 0 !important;
		text-decoration: none !important;

		box-shadow: none !important;
	}

	/* Divider between buttons */
	:global(.leaflet-control-zoom-in) {
		border-bottom: 1px solid #d1d5db !important;
	}

	/* Plus symbol */
	:global(.leaflet-control-zoom-in::before) {
		content: "+" !important;
		display: block !important;
		font-family: Arial, sans-serif !important;
		font-size: 23px !important;
		font-weight: 400 !important;
		line-height: 1 !important;
	}

	/* Minus symbol */
	:global(.leaflet-control-zoom-out::before) {
		content: "−" !important;
		display: block !important;
		font-family: Arial, sans-serif !important;
		font-size: 23px !important;
		font-weight: 400 !important;
		line-height: 1 !important;
	}

	/* Hover states */
	:global(.leaflet-control-zoom a:hover) {
		background: #f1f5f9 !important;
		color: #111 !important;
	}

	/* Disabled zoom buttons */
	:global(.leaflet-control-zoom a.leaflet-disabled) {
		color: #aaa !important;
		background: #f8fafc !important;
		cursor: default !important;
	}

	.district-info {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
		margin: 0;
	}

	.district-info h3 {
		margin: 0;
	}

	.district-info small {
		color: var(--pico-muted-color);
	}

	.district-info button {
		width: auto;
		margin: 0;
	}

	.hint {
		color: var(--pico-muted-color);
		text-align: center;
	}

	@media (max-width: 800px) {
		.district-explorer {
			padding: 1rem 1.5rem;
		}
	}

	@media (max-width: 600px) {
		.district-explorer {
			padding: 1rem;
		}

		.map {
			height: 420px;
		}

		header select {
			width: 100%;
		}

		.district-info {
			align-items: stretch;
		}

		.district-info button {
			width: 100%;
		}
	}
</style>
