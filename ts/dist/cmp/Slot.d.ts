/** The props `Slot` reads. */
type SlotProps = {
    /**
     * Matches the `<[SLOT:name]>` marker in the enclosing Fragment. Absent
     * means the unnamed `<[SLOT]>` marker.
     */
    name?: string;
};
declare const Slot: import("../types").Component<SlotProps, never, never>;
export { Slot };
export type { SlotProps };
