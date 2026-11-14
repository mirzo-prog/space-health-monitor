"""Build the dependency-free offline HTML from the tracked source modules."""
from pathlib import Path
import re
import base64
root = Path(__file__).resolve().parent
assets = root / 'dist'
portrait_uri = 'data:image/jpeg;base64,' + base64.b64encode((assets / 'astronaut-reference.jpg').read_bytes()).decode('ascii')
html = (assets / 'index.html').read_text().replace('src="astronaut-reference.jpg"', 'src="' + portrait_uri + '"')
css = (assets / 'style.css').read_text()
modules = []
for name in ('language-messages.mjs', 'i18n.mjs', 'daily-medical.mjs', 'crew.mjs', 'daily-ui.mjs', 'scene3d.mjs', 'pdf-report.mjs', 'assets.mjs', 'crew-portal.mjs', 'app.mjs'):
    source = (assets / name).read_text().replace("'astronaut-reference.jpg'", "'" + portrait_uri + "'")
    source = re.sub(r'^import .*?;\s*$', '', source, flags=re.MULTILINE)
    source = re.sub(r'\bexport (?=(const|class|function|async)\b)', '', source)
    modules.append(source)
html = html.replace('<link rel="stylesheet" href="style.css">', '<style>' + css + '</style>')
html = html.replace('<script type="module" src="app.mjs"></script>', '<script>\n' + '\n'.join(modules) + '\n</script>')
output = root.parent / 'Space-Health.html'
output.write_text(html)
print(output)
