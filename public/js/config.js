// Sorgenti cartografiche: facili da sostituire (vedi README, sezione "Mappe e licenze").
export const BASEMAPS = {
  sat: {
    label: 'Satellite',
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    tileSize: 256, maxzoom: 19,
    attribution: '© Esri, Maxar, Earthstar Geographics',
  },
  topo: {
    label: 'Topografica',
    tiles: ['https://a.tile.opentopomap.org/{z}/{x}/{y}.png', 'https://b.tile.opentopomap.org/{z}/{x}/{y}.png'],
    tileSize: 256, maxzoom: 17,
    attribution: '© OpenStreetMap contributors, SRTM | © OpenTopoMap (CC-BY-SA)',
  },
};
// Rilievo 3D: Terrain Tiles aperti su AWS (codifica Terrarium)
export const DEM = {
  tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
  encoding: 'terrarium', tileSize: 256, maxzoom: 14,
  attribution: 'Terrain: Mapzen / AWS Open Data',
};
export const POLL_MS = 8000;      // posizioni
export const STATS_MS = 30000;    // statistiche
export const TZ = 'Europe/Rome';
