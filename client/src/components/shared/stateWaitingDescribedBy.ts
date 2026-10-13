import { createContext } from "react";

/** Id of the open waiting panel, for `aria-describedby` on the State control. */
export const stateWaitingDescribedBy = createContext<string | undefined>(undefined);
