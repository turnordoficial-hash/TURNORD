import os
from playwright.sync_api import sync_playwright, expect

def run_test():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()

        # 1. Arrange: Go to the usuario.html page served by the local server.
        page.goto('http://localhost:8000/usuario.html')

        # 2. Act: Open the modal to register a turn.
        tomar_turno_button = page.get_by_role("button", name="TOMAR TURNO")
        tomar_turno_button.click()

        # Wait for the modal to be visible
        modal = page.locator("#modal")
        expect(modal).to_be_visible()

        # 3. Act: Fill out the form.
        page.get_by_placeholder("Nombre").fill("Jules Verne")
        page.get_by_placeholder("Teléfono").fill("1234567890")

        # Wait for services to be loaded and select one.
        servicio_select = page.locator('select[name="tipo"]')
        # Wait for an option other than the placeholder to be available
        expect(servicio_select.locator("option").nth(1)).to_be_attached(timeout=15000)

        # Get the value of the second option and select it.
        second_option_value = servicio_select.locator("option").nth(1).get_attribute("value")
        servicio_select.select_option(second_option_value)

        # 4. Act: Submit the form.
        registrar_button = page.get_by_role("button", name="Registrar")
        registrar_button.click()

        # 5. Assert: Confirm the success message appears.
        expect(modal).to_be_hidden(timeout=10000)

        confirmation_message = page.locator("#mensaje-turno .bg-green-100")
        expect(confirmation_message).to_be_visible(timeout=10000)
        expect(confirmation_message).to_contain_text("Hola Jules Verne, tu turno es")

        # 6. Screenshot: Capture the main card for visual verification.
        main_card = page.locator("div.text-center.shadow-lg")
        main_card.screenshot(path="jules-scratch/verification/verification.png")

        browser.close()

if __name__ == "__main__":
    run_test()
