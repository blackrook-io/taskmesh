import { Link } from "react-router-dom";
import { useContextNavItems, type ContextNavItem } from "../../lib/useShellNav";
import { NavIcon } from "./NavIcon";

function NavItem({ item }: { item: ContextNavItem }) {
  const content = (
    <>
      {item.icon ? (
        <span className="context-nav__glyph" aria-hidden>
          <NavIcon icon={item.icon} />
        </span>
      ) : null}
      <span>{item.label}</span>
    </>
  );

  if (item.disabled || !item.path) {
    return (
      <span
        className={`context-nav__item is-disabled${item.active ? " is-active" : ""}`}
        title={item.title}
      >
        {content}
      </span>
    );
  }

  return (
    <Link
      to={item.path}
      className={`context-nav__item${item.active ? " is-active" : ""}`}
      title={item.title}
    >
      {content}
    </Link>
  );
}

export function ContextNav() {
  const { title, items } = useContextNavItems();
  const mainItems = items.filter((item) => item.pin !== "bottom");
  const bottomItems = items.filter((item) => item.pin === "bottom");

  return (
    <nav className="context-nav" aria-label={title}>
      <h2 className="context-nav__title">{title}</h2>
      <ul className="context-nav__list">
        {mainItems.map((item) => (
          <li key={item.id}>
            <NavItem item={item} />
          </li>
        ))}
      </ul>
      {bottomItems.length > 0 ? (
        <ul className="context-nav__list context-nav__list--bottom">
          {bottomItems.map((item) => (
            <li key={item.id}>
              <NavItem item={item} />
            </li>
          ))}
        </ul>
      ) : null}
    </nav>
  );
}
