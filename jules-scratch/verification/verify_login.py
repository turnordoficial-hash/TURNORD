from playwright.sync_api import sync_playwright, Page, expect

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context()
    page = context.new_page()

    try:
        page.goto("http://localhost:5173/login_barberia005.html")

        heading = page.get_by_role("heading", name="Iniciar Sesión")
        expect(heading).to_be_visible()

        page.screenshot(path="jules-scratch/verification/final_verification.png")
        print("Final verification script ran successfully.")

    except Exception as e:
        print(f"An error occurred during final verification: {e}")
        page.screenshot(path="jules-scratch/verification/final_verification_error.png")

    finally:
        context.close()
        browser.close()

with sync_playwright() as playwright:
    run(playwright)
