import json
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.units import inch
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.colors import HexColor
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, PageBreak,
                                ListFlowable, ListItem, HRFlowable)
import html as _html

data = json.load(open('/tmp/legal.json'))
LEGAL = data['legal']
OUT = '/home/ccemeka/Techclave/Booking/Booking/Boka-Legal-Policies-DRAFT.pdf'

ss = getSampleStyleSheet()
h1 = ParagraphStyle('h1', parent=ss['Heading1'], fontSize=18, spaceBefore=6, spaceAfter=4, textColor=HexColor('#10211a'))
h2 = ParagraphStyle('h2', parent=ss['Heading2'], fontSize=12.5, spaceBefore=10, spaceAfter=3, textColor=HexColor('#10211a'))
body = ParagraphStyle('body', parent=ss['BodyText'], fontSize=10, leading=14, spaceAfter=5, textColor=HexColor('#222'))
small = ParagraphStyle('small', parent=body, fontSize=8.5, textColor=HexColor('#555'))
cover_t = ParagraphStyle('ct', parent=ss['Title'], fontSize=26, alignment=TA_CENTER, textColor=HexColor('#10211a'))
cover_s = ParagraphStyle('cs', parent=body, fontSize=11, alignment=TA_CENTER, textColor=HexColor('#555'))
draft = ParagraphStyle('draft', parent=body, fontSize=9, alignment=TA_CENTER, textColor=HexColor('#8a5a00'), backColor=HexColor('#fff6e5'), borderPadding=6)

def esc(t): return _html.escape(t).replace('&#x27;', "'")

story = []
# cover
story += [Spacer(1, 1.6*inch),
          Paragraph(f"{LEGAL['company']} · {LEGAL['product']}", cover_s),
          Spacer(1, 0.15*inch),
          Paragraph("Legal &amp; Compliance Policies", cover_t),
          Spacer(1, 0.15*inch),
          Paragraph(f"Consolidated draft for counsel review — last updated {LEGAL['lastUpdated']}", cover_s),
          Spacer(1, 0.4*inch),
          Paragraph("DRAFT — pending legal review. Placeholders (legal entity, registered address, "
                    "contact emails) are shown as bracketed/to-be-confirmed values in "
                    "src/lib/legal/constants.ts and must be finalized before publication. "
                    "This document is provided for review and is not yet legal advice.", draft),
          Spacer(1, 0.3*inch),
          Paragraph("Contents: " + " · ".join(d['title'] for d in data['docs']), small),
          PageBreak()]

for d in data['docs']:
    story += [Paragraph(esc(d['title']), h1),
              HRFlowable(width='100%', thickness=0.6, color=HexColor('#d8d4c6'), spaceAfter=6)]
    for sec in d['sections']:
        story.append(Paragraph(esc(sec['heading']), h2))
        items = [b for b in sec['blocks'] if b['type'] == 'li']
        for b in sec['blocks']:
            if b['type'] == 'p':
                story.append(Paragraph(esc(b['text']), body))
        if items:
            story.append(ListFlowable(
                [ListItem(Paragraph(esc(b['text']), body), leftIndent=10) for b in items],
                bulletType='bullet', start='•', leftIndent=14, spaceAfter=4))
    story.append(PageBreak())

def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont('Helvetica', 7.5); canvas.setFillColor(HexColor('#999'))
    canvas.drawCentredString(LETTER[0]/2, 0.4*inch,
        f"{LEGAL['company']} · {LEGAL['product']} — DRAFT legal policies — page {doc.page}")
    canvas.restoreState()

doc = SimpleDocTemplate(OUT, pagesize=LETTER, topMargin=0.9*inch, bottomMargin=0.8*inch,
                        leftMargin=0.9*inch, rightMargin=0.9*inch,
                        title="Boka Legal & Compliance Policies (DRAFT)", author=LEGAL['company'])
doc.build(story, onFirstPage=footer, onLaterPages=footer)
print("WROTE", OUT)
