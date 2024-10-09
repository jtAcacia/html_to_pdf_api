const express = require('express');
const puppeteer = require('puppeteer');
const multer = require('multer');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');

// Configure Express
const app = express();
// Use memory storage instead of disk storage
const storage = multer.memoryStorage();
const upload = multer({ storage: storage, 
    limits: { fileSize: 5 * 1024 * 1024 } 
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
            const htmlFilePath = path.join(__dirname, req.file.path);
            htmlContent = fs.readFileSync(htmlFilePath, 'utf-8');
            fs.unlinkSync(htmlFilePath);  // Delete the file after reading it
        } else if (req.body.htmlInput) {
            // Otherwise, use the pasted HTML content
            htmlContent = req.body.htmlInput;
        } else {
            return res.status(400).send('No HTML content provided.');
        }

        // Sanitize the HTML content following OWASP guidelines
        htmlContent = sanitizeHtml(htmlContent);

        // Launch Puppeteer
        const browser = await puppeteer.launch();
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

        await browser.close();

        // Send the generated PDF back to the client
        res.set({
            'Content-Type': 'application/pdf',
            'Content-Disposition': 'attachment; filename="generated.pdf"',
        });
        res.send(pdfBuffer);

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
