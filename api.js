const express = require('express');
const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core'); // Use puppeteer-core
const multer = require('multer');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');

chromium.setHeadlessMode = true;

// Configure Express
const app = express();
// Use memory storage for Multer with a file size limit
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }  // Limit file size to 5 MB
});

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());


function sanitizeHtml(html) {
    // Regular expression to remove <script>, <iframe>, and any inline event handlers (like onclick, onerror)
    html = html.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '');
    html = html.replace(/<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi, '');
    html = html.replace(/on\w+="[^"]*"/gi, ''); // Remove inline event handlers like onclick="..."
    html = html.replace(/on\w+='[^']*'/gi, ''); // Remove inline event handlers in single quotes
    return html;
}

// Serve static files (HTML form for GUI)
app.use(express.static('public'));

// Redirect HTTP to HTTPS for secure connections
app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] !== 'https' && process.env.NODE_ENV === 'production') {
        return res.redirect(`https://${req.headers.host}${req.url}`);
    }
    next();
});

// Endpoint to handle HTML input or file upload and convert to PDF
app.post('/upload', upload.single('htmlFile'), async (req, res) => {
    console.log('Upload request received');
    try {
        let htmlContent = '';

        // If the user uploaded an HTML file, use it
        if (req.file) {
            htmlContent = req.file.buffer.toString('utf-8'); // Extract file content from buffer
        } else if (req.body.htmlInput) {
            // Otherwise, use the pasted HTML content
            htmlContent = req.body.htmlInput;
        } else {
            return res.status(400).send('No HTML content provided.');
        }

        // Sanitize the HTML content following OWASP guidelines
        htmlContent = sanitizeHtml(htmlContent);
        // Log Chromium path

        const chromiumPath = await chromium.executablePath();
        console.log('Chromium executable path:', chromiumPath);  // Check if a valid path is returned

        if (!chromiumPath) {
            return res.status(500).send('Chromium executable not found.');
        }
        console.log(chromium.args);
        // Launch Puppeteer with @sparticuz/chromium for Vercel support
        //    const browser = await puppeteer.launch({
        //     args: chromium.args,
        //     executablePath: await chromium.executablePath(), // Use the optimized Chromium path
        //     headless: chromium.headless,
        //   });
        const browser = await puppeteer.launch({
            args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'], // Use correct Chromium args
            executablePath: chromiumPath, // Use the optimized Chromium binary
            headless: chromium.headless, // Run in headless mode
        });

        console.log('Memory usage:', process.memoryUsage());
        console.log('Chromium arguments:', chromium.args);
        console.log('Node environment:', process.env.NODE_ENV);

        const page = await browser.newPage();

        // Set the HTML content
        await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

        // Remove the element with id="awesomewrap" using JavaScript in the browser context
        await page.evaluate(() => {
            const element = document.getElementById('awesomewrap');
            if (element) {
                element.remove();
            }
        });

        // Dynamically calculate the content height
        const contentHeight = await page.evaluate(() => {
            document.body.style.margin = "0";  // Ensure no margins around the body
            return document.documentElement.scrollHeight;
        });

        
        // Generate a PDF with dynamic height to avoid extra pages
        const pdfBuffer = await page.pdf({
            width: '210mm', // A4 width
            height: `${contentHeight}px`, // Use the exact height based on content
            printBackground: true,
            preferCSSPageSize: true,
            pageRanges: '1',  // Ensure only the first page with content is generated
        });

        const pdfBase64 = pdfBuffer.toString('base64');
        
        await browser.close();

        // Send the generated PDF back to the client
        res.set({
            'Content-Type': 'application/pdf',
            'Content-Disposition': 'attachment; filename="generated.pdf"',
        });
        res.send(Buffer.from(pdfBase64, 'base64'));
        //res.send(pdfBuffer);

    } catch (error) {
        console.error(error);
        res.status(500).send('Error processing HTML to PDF.');
    }
});

// LOCAL SERVER ONLY: Start the server on port 3000 if running locally
if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3001;
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
}

module.exports = app;
