"""Editable DOCX + print HTML from report.md; Python standard library only."""
from pathlib import Path
from xml.sax.saxutils import escape
from zipfile import ZipFile, ZIP_DEFLATED
from xml.etree import ElementTree
import base64
import re
import struct

ROOT = Path(__file__).resolve().parent.parent
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
IMAGES = []


def tokens(source):
    lines, index = source.splitlines(), 0
    while index < len(lines):
        line = lines[index].strip()
        if not line or line.startswith('<!--'):
            index += 1
            continue
        if line == '---':
            yield 'break', ''
        elif line.startswith('```'):
            code = []
            index += 1
            while index < len(lines) and not lines[index].startswith('```'):
                code.append(lines[index]); index += 1
            yield 'code', '\n'.join(code)
        elif line.startswith('|'):
            rows = []
            while index < len(lines) and lines[index].strip().startswith('|'):
                # Escaped pipes in type/enum cells do not split a column.
                cells = [cell.strip().replace('\\|', '|') for cell in re.split(r'(?<!\\)\|', lines[index].strip().strip('|'))]
                if not all(re.fullmatch(r':?-{3,}:?', cell) for cell in cells): rows.append(cells)
                index += 1
            yield 'table', rows
            continue
        elif re.match(r'^!\[.*\]\(.*\)$', line):
            image = re.fullmatch(r'!\[(.*?)\]\((.*?)\)', line)
            yield 'image', (image[1], image[2])
        elif re.match(r'^#{1,4} ', line):
            heading, text = line.split(' ', 1)
            yield 'heading', (len(heading), text)
        else:
            yield 'paragraph', line
        index += 1


def plain(text):
    return re.sub(r'\[([^]]+)\]\(([^)]+)\)', r'\1', text).replace('**', '').replace('`', '')


def runs(text):
    parts = re.split(r'(\*\*.*?\*\*|`[^`]+`)', re.sub(r'\[([^]]+)\]\(([^)]+)\)', r'\1 (\2)', text))
    return ''.join(f'<w:r>{"<w:rPr><w:b/></w:rPr>" if part.startswith("**") else ""}<w:t xml:space="preserve">{escape(part[2:-2] if part.startswith("**") else part.strip("`"))}</w:t></w:r>' for part in parts if part)


def paragraph(text, style='Normal'):
    return f'<w:p><w:pPr><w:pStyle w:val="{style}"/></w:pPr>{runs(text)}</w:p>'


def image_xml(caption, source):
    path = (ROOT / 'docs' / source).resolve()
    if not path.is_relative_to(ROOT / 'docs') or not path.exists(): raise ValueError(f'Missing/invalid report figure: {source}')
    data = path.read_bytes()
    if data[:8] != b'\x89PNG\r\n\x1a\n': raise ValueError('Report images must be PNG')
    width, height = struct.unpack('>II', data[16:24])
    scale = min(5.95 / width, 7.4 / height)
    cx, cy = int(width * scale * 914400), int(height * scale * 914400)
    number = len(IMAGES) + 1
    IMAGES.append((f'image{number}.png', data))
    return f'''<w:p><w:pPr><w:jc w:val="center"/><w:keepNext/></w:pPr><w:r><w:drawing>
<wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="{cx}" cy="{cy}"/><wp:docPr id="{number}" name="Figure {number}" descr="{escape(caption)}"/>
<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
<pic:nvPicPr><pic:cNvPr id="{number}" name="Figure {number}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="image{number}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>''' + paragraph(caption, 'Caption')


def table_xml(rows):
    output = '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>'
    output += ''.join(f'<w:{side} w:val="single" w:sz="4" w:color="B8C5D3"/>' for side in ['top','left','bottom','right','insideH','insideV'])
    output += '</w:tblBorders><w:tblCellMar><w:top w:w="75" w:type="dxa"/><w:left w:w="75" w:type="dxa"/><w:bottom w:w="75" w:type="dxa"/><w:right w:w="75" w:type="dxa"/></w:tblCellMar></w:tblPr>'
    for index, row in enumerate(rows):
        output += '<w:tr><w:trPr><w:cantSplit/>' + ('<w:tblHeader/>' if index == 0 else '') + '</w:trPr>'
        for cell in row:
            output += '<w:tc><w:tcPr>' + ('<w:shd w:fill="EAF0F6"/>' if index == 0 else '') + '</w:tcPr>' + paragraph(cell, 'TableHeader' if index == 0 else 'TableText') + '</w:tc>'
        output += '</w:tr>'
    return output + '</w:tbl>' + paragraph('')


def styles_xml():
    output = f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="26"/><w:lang w:val="vi-VN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:jc w:val="both"/><w:spacing w:after="100" w:line="320" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>'
    for level, size in [(1,32),(2,28),(3,26),(4,26)]:
        output += f'<w:style w:type="paragraph" w:styleId="Heading{level}"><w:name w:val="heading {level}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:jc w:val="left"/><w:outlineLvl w:val="{level-1}"/><w:spacing w:before="220" w:after="140"/></w:pPr><w:rPr><w:b/><w:sz w:val="{size}"/></w:rPr></w:style>'
    for name, properties, run_properties in [
        ('Title','<w:jc w:val="center"/><w:spacing w:before="200" w:after="200"/>','<w:b/><w:sz w:val="36"/>'),
        ('Cover','<w:jc w:val="center"/><w:spacing w:after="200"/>',''),
        ('Chapter','<w:pageBreakBefore/><w:keepNext/><w:jc w:val="center"/><w:outlineLvl w:val="0"/>','<w:b/><w:sz w:val="32"/>'),
        ('Caption','<w:jc w:val="center"/><w:spacing w:after="180"/>','<w:i/><w:sz w:val="23"/>'),
        ('Code','<w:jc w:val="left"/><w:spacing w:after="0" w:line="240"/>','<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="19"/>'),
        ('TableText','<w:jc w:val="left"/><w:spacing w:after="50" w:line="265"/>','<w:sz w:val="23"/>'),
        ('TableHeader','<w:jc w:val="left"/><w:spacing w:after="50" w:line="265"/>','<w:b/><w:sz w:val="23"/>')]:
        output += f'<w:style w:type="paragraph" w:styleId="{name}"><w:name w:val="{name}"/><w:basedOn w:val="Normal"/><w:pPr>{properties}</w:pPr><w:rPr>{run_properties}</w:rPr></w:style>'
    return output + '</w:styles>'


def html_inline(text):
    value = escape(text)
    value = re.sub(r'\*\*(.*?)\*\*', r'<strong>\1</strong>', value)
    return re.sub(r'`([^`]+)`', r'<code>\1</code>', value)


def build():
    IMAGES.clear()
    source = (ROOT / 'docs/report.md').read_text(encoding='utf-8')
    word, html, cover = [], [], True
    headings = [value[1] for kind,value in tokens(source) if kind == 'heading' and value[0] == 1]
    for kind, value in tokens(source):
        if kind == 'break':
            word.append('<w:p><w:r><w:br w:type="page"/></w:r></w:p>'); html.append('<div class="page-break"></div>'); cover = False
        elif kind == 'heading':
            level, title = value
            chapter = level == 1 and title.startswith(('CHƯƠNG','TÀI LIỆU','PHỤ LỤC'))
            style = 'Title' if cover else 'Chapter' if chapter else f'Heading{level}'
            word.append(paragraph(title, style)); html.append(f'<h{level} class="{"chapter" if chapter else "cover" if cover else ""}">{html_inline(title)}</h{level}>')
        elif kind == 'image':
            caption,path = value; word.append(image_xml(caption,path))
            image = base64.b64encode((ROOT/'docs'/path).read_bytes()).decode()
            html.append(f'<figure><img src="data:image/png;base64,{image}"><figcaption>{escape(caption)}</figcaption></figure>')
        elif kind == 'table':
            word.append(table_xml(value))
            html.append('<table><thead>'+''.join('<tr>'+''.join(f'<th>{html_inline(cell)}</th>' for cell in row)+'</tr>' for row in value[:1])+'</thead><tbody>'+''.join('<tr>'+''.join(f'<td>{html_inline(cell)}</td>' for cell in row)+'</tr>' for row in value[1:])+'</tbody></table>')
        elif kind == 'code':
            word.extend(paragraph(line,'Code') for line in value.splitlines()); html.append(f'<pre>{escape(value)}</pre>')
        elif value == '[TOC]':
            field = '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r></w:p>'
            word.append(field + ''.join(paragraph(title) for title in headings) + '<w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>')
            html.append('<nav>'+''.join(f'<p>{escape(title)}</p>' for title in headings)+'</nav>')
        else:
            word.append(paragraph(value,'Cover' if cover else 'Normal')); html.append(f'<p class="{"cover" if cover else ""}">{html_inline(value)}</p>')
    section = '<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1587"/></w:sectPr>'
    document = f'<w:document xmlns:w="{W}" xmlns:r="{R}"><w:body>{"".join(word)}{section}</w:body></w:document>'
    types = '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>'
    for part,kind in [('document','document.main'),('styles','styles'),('footer1','footer'),('settings','settings')]: types += f'<Override PartName="/word/{part}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.{kind}+xml"/>'
    types += '</Types>'
    rel_namespace = 'http://schemas.openxmlformats.org/package/2006/relationships'
    relationships = f'<Relationships xmlns="{rel_namespace}"><Relationship Id="rIdStyles" Type="{R}/styles" Target="styles.xml"/><Relationship Id="rIdFooter" Type="{R}/footer" Target="footer1.xml"/><Relationship Id="rIdSettings" Type="{R}/settings" Target="settings.xml"/>'
    for index,(name,_) in enumerate(IMAGES,1): relationships += f'<Relationship Id="image{index}" Type="{R}/image" Target="media/{name}"/>'
    relationships += '</Relationships>'
    parts = {'[Content_Types].xml': types,
        '_rels/.rels': f'<Relationships xmlns="{rel_namespace}"><Relationship Id="rId1" Type="{R}/officeDocument" Target="word/document.xml"/></Relationships>',
        'word/document.xml': document, 'word/styles.xml': styles_xml(), 'word/_rels/document.xml.rels': relationships,
        'word/settings.xml': f'<w:settings xmlns:w="{W}"><w:updateFields w:val="true"/></w:settings>',
        'word/footer1.xml': f'<w:ftr xmlns:w="{W}"><w:p><w:pPr><w:jc w:val="center"/></w:pPr>{runs("DS03 — Hệ thống đặt xe · ")}<w:fldSimple w:instr="PAGE"/></w:p></w:ftr>'}
    with ZipFile(ROOT/'docs/report.docx','w',ZIP_DEFLATED) as archive:
        for name,data in parts.items(): archive.writestr(name,data.encode('utf-8'))
        for name,data in IMAGES: archive.writestr('word/media/'+name,data)
    with ZipFile(ROOT/'docs/report.docx') as archive:
        assert archive.testzip() is None
        for name in archive.namelist():
            if name.endswith(('.xml','.rels')): ElementTree.fromstring(archive.read(name))
    css = '''@page{size:A4;margin:20mm 20mm 20mm 28mm}body{font:13pt "Times New Roman",serif;line-height:1.35;color:#111}p{text-align:justify;margin:0 0 8pt;orphans:3;widows:3}.cover{text-align:center;margin:20pt 0}h1{font-size:17pt}h2{font-size:15pt}h3,h4{font-size:13pt}h1,h2,h3,h4{break-after:avoid}.chapter{break-before:page;text-align:center}table{width:100%;border-collapse:collapse;font-size:11pt;margin:12pt 0}th,td{border:1px solid #aab8c6;padding:5pt;text-align:left;overflow-wrap:anywhere}th{background:#edf2f7}tr{break-inside:avoid}thead{display:table-header-group}figure{margin:14pt 0;break-inside:avoid;text-align:center}img{max-width:100%;max-height:205mm}figcaption{font-size:11pt;font-style:italic;margin:7pt 0}pre{font:9.5pt Consolas,monospace;white-space:pre-wrap;background:#f4f6f8;padding:8pt;overflow-wrap:anywhere}code{font-size:10pt}nav p{text-align:left}.page-break{break-after:page}'''
    (ROOT/'artifacts').mkdir(exist_ok=True)
    (ROOT/'artifacts/report-preview.html').write_text('<!doctype html><html lang="vi"><meta charset="utf-8"><title>DS03 — Báo cáo</title><style>'+css+'</style><body>'+''.join(html)+'</body></html>',encoding='utf-8')
    print(f'Report DOCX/HTML generated; {len(IMAGES)} embedded figures; OOXML/ZIP validation PASS')


if __name__ == '__main__': build()
