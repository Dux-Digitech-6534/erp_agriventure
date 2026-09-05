app_name = "agriventure"
app_title = "Agriventure"
app_publisher = "Dux"
app_description = "Custom ERPNext purchasing portal"
app_email = "dev@duxdigitech.in"
app_license = "mit"

# The whole app is one Desk page. It ships no DocType, so nothing already on the site is
# overwritten by a migrate, and it registers no doc_event, so no existing document behaves
# any differently for having installed this.
page_js = {"agriventure": "public/js/agriventure.js"}

# The page injects its own stylesheet (see ensureStyles), so app_include_css would only put
# these rules on every other Desk page for nothing.

after_install = "agriventure.install.after_install"
