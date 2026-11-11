// The site's contact address, in a module that imports nothing: the document
// pages (pages/docs.tsx, which exports it again) import the accounts' privacy
// text, so an account module that names the address reads it from here and
// no import runs in a circle.
export const CONTACT_EMAIL = "contact@awardwatch.ca";
