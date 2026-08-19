import { findFreeStaff, findFreeSlot, nextAvailableSlot } from './optimizedScheduler';

export * from './optimizedScheduler';

const scheduler = { findFreeStaff, findFreeSlot, nextAvailableSlot };
export default scheduler;
