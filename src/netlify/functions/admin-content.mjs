import { requireSession } from './_lib/auth.mjs';
import { createAdminContentHandler } from './_lib/content.mjs';

export default createAdminContentHandler({ requireSession });
