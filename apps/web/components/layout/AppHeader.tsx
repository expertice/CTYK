"use client";

import { useState } from "react";
import Link from "next/link";
import { getUiCopy } from "../../lib/i18n/ui-copy";
import { GlobalSettingsWindow } from "../settings/GlobalSettingsWindow";

export function AppHeader() {
  const copy = getUiCopy("ru");
  const [openSettings, setOpenSettings] = useState(false);

  return (
    <>
      <header className="app-header" aria-label="Главная панель навигации">
        <div className="app-header-inner">
          <div className="app-header-left">
            <Link href="/" className="app-header-title">
              {copy.home.title}
            </Link>
          </div>
          <div className="app-header-right">
            <Link href="/sessions/new" className="app-header-link">
              {copy.home.cta}
            </Link>
            <Link href="/scenarios/build" className="app-header-link">
              {copy.home.pipelineBuilderLink}
            </Link>
            <button
              type="button"
              className="app-header-settings-button"
              aria-label={copy.settingsModal.dialogAria}
              title={copy.settingsModal.title}
              onClick={() => setOpenSettings(true)}
            >
              <span className="app-header-settings-icon">
                <span />
                <span />
                <span />
              </span>
            </button>
          </div>
        </div>
      </header>
      <GlobalSettingsWindow open={openSettings} onClose={() => setOpenSettings(false)} />
    </>
  );
}

