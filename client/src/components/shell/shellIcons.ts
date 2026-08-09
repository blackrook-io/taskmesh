import {
  faBook,
  faCalendarDays,
  faClipboardList,
  faColumns,
  faDrawPolygon,
  faFolder,
  faGear,
  faHouse,
  faImage,
  faLightbulb,
  faListUl,
  faMagnifyingGlass,
  faPlus,
  faRobot,
  faTableCells,
  faUser,
} from "@fortawesome/free-solid-svg-icons";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";

/** Shared FA icons for shell chrome (Phase 12b). */
export const shellIcons = {
  projects: faTableCells,
  ideas: faLightbulb,
  filesystem: faFolder,
  imageBoard: faImage,
  lists: faListUl,
  calendar: faCalendarDays,
  settings: faGear,
  tasks: faClipboardList,
  kanban: faColumns,
  canvas: faDrawPolygon,
  documents: faBook,
  home: faHouse,
  assistant: faRobot,
  search: faMagnifyingGlass,
  add: faPlus,
  profile: faUser,
} as const satisfies Record<string, IconDefinition>;
