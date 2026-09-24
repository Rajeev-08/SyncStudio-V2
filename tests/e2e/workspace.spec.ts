import { test, expect, type BrowserContext, type Page } from "@playwright/test";

const suffix = Date.now().toString(36);

async function register(page: Page, name: string) {
  await page.goto("/register");

  await page.getByLabel("Username").fill(name + suffix);
  await page
    .getByLabel("Email address")
    .fill(`${name}${suffix}@example.test`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("E2eTestPassword123!");

  await page
    .getByRole("button", {
      name: "Create account",
      exact: true,
    })
    .click();

  await expect(
    page.getByRole("heading", { name: "Your projects" }),
  ).toBeVisible();
}

async function createProject(page: Page, name: string) {
  await page
    .getByRole("button", {
      name: "New project",
      exact: true,
    })
    .click();

  const dialog = page.getByRole("dialog");

  await expect(dialog).toBeVisible();

  await dialog.getByLabel("Project name").fill(name);

  await dialog
    .getByRole("button", {
      name: "Create project",
      exact: true,
    })
    .click();

  await expect(
    page.getByRole("textbox", {
      name: "Editor content",
      exact: true,
    }),
  ).toBeVisible();
}

async function closeContext(context: BrowserContext) {
  try {
    await context.close();
  } catch {
    // Playwright may already have disposed the context when the test ended.
  }
}

test(
  "two users collaborate, preview, snapshot, restore and enforce isolation",
  async ({ browser }) => {
    const owner = await browser.newContext();
    const editor = await browser.newContext();
    const stranger = await browser.newContext();

    const a = await owner.newPage();
    const b = await editor.newPage();
    const c = await stranger.newPage();

    try {
      await register(a, "owner");
      await register(b, "editor");
      await register(c, "stranger");

      await createProject(a, "E2E workspace");

      const url = a.url();

      /*
       * Add collaborator.
       */
      await a
        .getByRole("button", {
          name: "Members",
          exact: true,
        })
        .click();

      await a
        .getByLabel("Email", {
          exact: true,
        })
        .fill(`editor${suffix}@example.test`);

      await a
        .getByRole("button", {
          name: "Add member",
          exact: true,
        })
        .click();

      await expect(
        a.getByText("Member added", {
          exact: true,
        }),
      ).toBeVisible();

      /*
       * Open the project as the editor.
       */
      await b.goto(url);

      await expect(
        b.getByRole("textbox", {
          name: "Editor content",
          exact: true,
        }),
      ).toBeVisible();

      const ea = a.getByRole("textbox", {
          name: "Editor content",
          exact: true,
        }),
        eb = b.getByRole("textbox", {
          name: "Editor content",
          exact: true,
        });

      /*
       * Concurrent editing.
       */
      await Promise.all([
        ea.press("ControlOrMeta+End"),
        eb.press("ControlOrMeta+End"),
      ]);

      await Promise.all([
        ea.pressSequentially("\n<!-- FROM_OWNER -->"),
        eb.pressSequentially("\n<!-- FROM_EDITOR -->"),
      ]);

      await expect
        .poll(async () => a.locator(".view-lines").innerText())
        .toContain("FROM_EDITOR");

      await expect
        .poll(async () => b.locator(".view-lines").innerText())
        .toContain("FROM_OWNER");

      await expect(
        a.locator('[class*="yRemoteSelectionHead-"]').first(),
      ).toBeVisible();

      /*
       * Open Preview through the command palette.
       *
       * The application does not expose a dedicated "Preview" toolbar
       * button. Its command palette contains "Toggle preview".
       */
      await a
        .getByRole("button", {
          title: "Command palette",
        })
        .click();

      const commandPalette = a.getByRole("dialog");

      await expect(commandPalette).toBeVisible();

      await commandPalette
        .getByLabel("Search commands or files")
        .fill("Toggle preview");

      await commandPalette
        .getByRole("button", {
          name: "Toggle preview",
          exact: true,
        })
        .click();

      /*
       * Wait for the preview iframe itself before entering it.
       */
      const preview = a.locator('iframe[title="Project preview"]');

      await expect(preview).toBeVisible();

      const frame = a.frameLocator(
        'iframe[title="Project preview"]',
      );

      /*
       * Preview compilation is intentionally debounced by 650 ms.
       * Wait for the actual application button rather than assuming
       * the iframe is ready immediately after it appears.
       */
      const counter = frame.getByRole("button", {
        name: "Make it happen · 0",
        exact: true,
      });

      await expect(counter).toBeVisible({
        timeout: 30000,
      });

      await counter.click();

      await expect(
        frame.getByRole("button", {
          name: "Make it happen · 1",
          exact: true,
        }),
      ).toBeVisible({
        timeout: 10000,
      });

      await expect(a.getByRole("log")).toContainText(
        "You made it happen",
      );

      /*
       * Version history.
       */
      await a
        .getByRole("button", {
          name: "Version history",
          exact: true,
        })
        .click();

      await a
        .getByLabel("Snapshot message")
        .fill("Working milestone");

      await a
        .getByRole("button", {
          name: "Create snapshot",
          exact: true,
        })
        .click();

      await expect(
        a.getByText("Snapshot created", {
          exact: true,
        }),
      ).toBeVisible();

      /*
       * Make a change after the snapshot.
       */
      await ea.press("ControlOrMeta+End");
      await ea.pressSequentially("\n<!-- AFTER_SNAPSHOT -->");

      await expect(
        a.getByRole("button", {
          name: "Saved",
          exact: true,
        }),
      ).toBeVisible();

      /*
       * Compare snapshot.
       */
      await a
        .getByRole("button", {
          name: "Compare",
          exact: true,
        })
        .click();

      await expect(
        a.getByRole("dialog"),
      ).toBeVisible();

      await a
        .getByRole("button", {
          name: "Close dialog",
          exact: true,
        })
        .click();

      /*
       * Restore snapshot.
       */
      await a
        .getByRole("button", {
          name: "Restore snapshot",
          exact: true,
        })
        .click();

      const restoreDialog = a.getByRole("dialog");

      await expect(restoreDialog).toBeVisible();

      await restoreDialog
        .getByRole("button", {
          name: "Restore snapshot",
          exact: true,
        })
        .click();

      await expect
        .poll(async () => a.locator(".view-lines").innerText())
        .not.toContain("AFTER_SNAPSHOT");

      /*
       * Stranger must not be able to open the project.
       */
      await c.goto(url);

      await expect(
        c.getByRole("heading", {
          name: "Couldn’t open this project",
        }),
      ).toBeVisible();
    } finally {
      await closeContext(owner);
      await closeContext(editor);
      await closeContext(stranger);
    }
  },
);

test(
  "nested explorer, tabs, quick open and search",
  async ({ page }) => {
    await register(page, "files");

    await createProject(page, "File operations");

    /*
     * Create a nested folder/file.
     */
    await page
      .getByRole("button", {
        name: "New folder",
        exact: true,
      })
      .click();

    await page
      .getByLabel("Path", {
        exact: true,
      })
      .fill("src");

    await page
      .getByRole("button", {
        name: "Save",
        exact: true,
      })
      .click();

    await page
      .getByRole("button", {
        name: "New file",
        exact: true,
      })
      .click();

    await page
      .getByLabel("Path", {
        exact: true,
      })
      .fill("src/test.js");

    await page
      .getByRole("button", {
        name: "Save",
        exact: true,
      })
      .click();

    await page
      .getByRole("button", {
        name: "test.js",
        exact: true,
      })
      .click();

    await expect(
      page.getByRole("tab", {
        name: "JS test.js",
      }),
    ).toBeVisible();

    /*
     * Quick Open.
     */
    await page
      .getByRole("button", {
        name: "Quick open",
        exact: true,
      })
      .click();

    const quickOpen = page.getByRole("dialog");

    await expect(quickOpen).toBeVisible();

    await quickOpen
      .getByLabel("Search commands or files")
      .fill("styles");

    /*
     * The starter template may contain either:
     *   styles.css
     * or
     *   src/styles.css
     *
     * Quick Open renders the complete path, so match by suffix.
     */
    const stylesResult = quickOpen
      .locator("button")
      .filter({
        hasText: /(?:^|\/)styles\.css$/,
      })
      .first();

    await expect(stylesResult).toBeVisible({
      timeout: 15000,
    });

    await stylesResult.click();

    /*
     * Verify that the selected tab corresponds to styles.css.
     *
     * Depending on the template the tab label can be:
     *   "# styles.css"
     * or
     *   "# src/styles.css"
     */
    await expect(
      page
        .getByRole("tab")
        .filter({
          hasText: "styles.css",
        })
        .first(),
    ).toHaveAttribute(
      "aria-selected",
      "true",
    );

    /*
     * Workspace search.
     */
    await page
      .getByRole("button", {
        name: "Search",
        exact: true,
      })
      .click();

    await page
      .getByLabel("Search workspace")
      .fill("background");

    await expect(
      page.locator(".search-result").first(),
    ).toBeVisible();
  },
);
