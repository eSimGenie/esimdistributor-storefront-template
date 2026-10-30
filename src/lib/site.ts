import raw from '../../site.config.json';
import { parseSiteConfig, type SiteConfig } from './config-schema';

/**
 * The validated site config. Parsing happens at module load, so an invalid
 * site.config.json fails `astro build` (and `npm run setup`) with a readable message.
 */
export const site: SiteConfig = parseSiteConfig(raw);
