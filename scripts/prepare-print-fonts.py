from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

# Derive print-ready static weights from the exact Roboto font used on the site.
root = Path(__file__).resolve().parents[1]
source = root / 'assets/fonts/roboto-fb5169d9.woff2'
for name, weight in [('regular', 400), ('bold', 700)]:
    font = TTFont(source)
    instantiateVariableFont(font, {'wght': weight}, inplace=True)
    font.flavor = None
    font.save(root / f'assets/fonts/roboto-print-{name}.ttf')
