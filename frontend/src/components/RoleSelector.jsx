import React from "react";

export default function RoleSelector({ activeRole, onSelectRole }) {
  return (
    <div className="role-selector-container">
      <div className="role-selector-tabs">
        <button
          className={`role-tab ${activeRole === "claimer" ? "active" : ""}`}
          onClick={() => onSelectRole("claimer")}
        >
          🎁 Claimer View
        </button>
        <button
          className={`role-tab ${activeRole === "organizer" ? "active" : ""}`}
          onClick={() => onSelectRole("organizer")}
        >
          🛠️ Organizer View
        </button>
      </div>
      <p className="role-selector-hint">
        Role selection is a view preference. Any wallet can organize campaigns or claim allocated tokens.
      </p>
    </div>
  );
}
