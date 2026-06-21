import { registerAs } from '@nestjs/config';

export default registerAs('maps', () => ({
  apiKey: process.env.GOOGLE_MAPS_API_KEY,
  mapboxToken: process.env.MAPBOX_ACCESS_TOKEN,
  defaultRegionCode: process.env.PLACES_REGION_CODE || 'KE',
}));
