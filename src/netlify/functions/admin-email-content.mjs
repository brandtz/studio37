import { requireSession } from './_lib/auth.mjs';
import { createAdminEmailContentHandler } from './_lib/email-content.mjs';

export default createAdminEmailContentHandler({ requireSession });
