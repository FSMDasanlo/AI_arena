# AI_arena
comparativa de AI ARENA

## Preparación

Con Node.js 24 instalado, ejecuta `npm ci` y `npm run build`. Copia
`js/config.example.js` a `js/config.js` y configura las claves. Sirve la carpeta
con un servidor HTTP local (por ejemplo, Live Server de VS Code): los módulos
de PDF necesitan una página servida por HTTP. GitHub Pages ejecuta la
construcción automáticamente.

Las claves configuradas en la página son visibles para quienes puedan acceder a
ella, aunque `config.js` esté excluido de Git. Para protegerlas en un despliegue
público sería necesario usar un servidor intermediario.

## Archivos adjuntos

En el duelo se puede adjuntar un archivo de texto (hasta 200 KB), un PDF, un ZIP
o una imagen JPG/PNG (hasta 10 MB). El PDF se convierte a texto: los PDF
escaneados sin texto seleccionable no son compatibles (no hay OCR).

Un ZIP admite hasta 100 archivos, 10 MB comprimidos y 10 MB de contenido
compatible descomprimido.
Dentro se procesan archivos de texto, PDF, DOCX, XLSX y JPG/PNG; los archivos
incompatibles, incluidos los DOC antiguos y ZIP anidados, se indican en pantalla.
El texto combinado tiene un límite de 200 KB; los archivos que excedan ese
límite se omiten con un aviso. Se extrae el texto de los documentos, no sus
imágenes incrustadas. Los datos se procesan en el navegador.

El texto se envía a Groq y Gemini; las imágenes solo se envían a Gemini. Si el
adjunto contiene únicamente imágenes, solo responde Gemini. En ZIP mixtos, Groq
responde al texto y Gemini recibe el texto y las imágenes. El modo de diálogos
no admite archivos adjuntos.
