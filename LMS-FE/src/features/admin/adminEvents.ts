export const ADMIN_CHANGED = 'admin:changed'

/** Tell the admin layout to refresh its counts. */
export const adminChanged = () => window.dispatchEvent(new Event(ADMIN_CHANGED))
