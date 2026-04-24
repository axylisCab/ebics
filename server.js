const express = require('express');
const cors = require('cors');
const axios = require('axios');
const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs-extra');
require('dotenv').config();

const app = express();
app.use(cors());
// On augmente la limite pour recevoir le PDF en Base64
app.use(express.json({ limit: '50mb' }));

const DEPOT_PATH = process.env.DEPOT_PATH || path.join(__dirname, 'DEPOT_EBICS');
const EXCEL_PATH = process.env.EXCEL_PATH || path.join(__dirname, 'DEMANDE EBICS.xlsx');
const BREVO_API_KEY = process.env.BREVO_API_KEY;

// S'assurer que le dossier de dépôt existe
fs.ensureDirSync(DEPOT_PATH);

app.post('/api/submit', async (req, res) => {
    try {
        const { formData, pdfBase64 } = req.body;
        const dateStr = new Date().toLocaleDateString('fr-FR').replace(/\//g, '-');

        // Nouveau format de nommage: [dossier]-[entreprise]-[trigramme]-[date].pdf
        const cleanEntreprise = formData.nomEntreprise.replace(/[^a-z0-9]/gi, '_').toUpperCase();
        const fileName = `${formData.numDossier}-${cleanEntreprise}-${formData.trigramme.toUpperCase()}-${dateStr}.pdf`;
        const filePath = path.join(DEPOT_PATH, fileName);

        console.log('Traitement de la demande:', fileName);

        // 1. Enregistrement du PDF dans le dépôt
        if (pdfBase64) {
            // Extraction robuste du contenu base64
            const base64Data = pdfBase64.split(';base64,').pop();
            await fs.writeFile(filePath, base64Data, 'base64');
            console.log('Fichier sauvegardé avec succès:', fileName);
        }

        // 2. Mise à jour de l'Excel (colonnes A, C, D, E, F, H, I, J, K, N)
        const workbook = new ExcelJS.Workbook();
        try {
            await workbook.xlsx.readFile(EXCEL_PATH);
            const worksheet = workbook.worksheets[0]; // On prend la première feuille du classeur
            
            if (worksheet) {
                // Trouver la vraie dernière ligne avec des données
                let lastDataRow = 0;
                worksheet.eachRow((row, rowNumber) => {
                    if (row.getCell(1).value || row.getCell(6).value) {
                        lastDataRow = rowNumber;
                    }
                });

                const targetRowNumber = lastDataRow + 1;
                const row = worksheet.getRow(targetRowNumber);
                console.log(`DEBUG: Utilisation de la ligne réelle ${targetRowNumber} pour ${formData.nomEntreprise}`);


                // Mapping des colonnes (A=1, C=3, D=4, E=5, F=6, H=8, I=9, J=10, K=11, N=14)
                row.getCell(1).value  = formData.numDossier;                                                    // A: NUMERO DOSSIER
                row.getCell(3).value  = formData.trigramme;                                                     // C: COLLAB
                row.getCell(4).value  = new Date().toLocaleDateString('fr-FR');                                 // D: DATE DEMANDE
                row.getCell(5).value  = formData.agence;                                                        // E: SITE
                row.getCell(6).value  = formData.nomEntreprise;                                                 // F: NOM DOSSIER
                row.getCell(8).value  = formData.siret || '';                                                   // H: SIRET
                row.getCell(9).value  = formData.iban;                                                         // I: IBAN
                row.getCell(10).value = formData.bic;                                                           // J: BIC
                row.getCell(11).value = formData.responsable;                                                   // K: NOM - PRENOM RESPONSABLE
                row.getCell(14).value = formData.logiciel === 'Autres' ? formData.autreLogiciel : formData.logiciel; // N: LOGICIEL DE TENUE
                row.getCell(20).value = formData.commentaires || '';                                            // T: COMMENTAIRES

                await workbook.xlsx.writeFile(EXCEL_PATH);
                console.log(`✅ Excel mis à jour (Sheet: ${worksheet.name}, Ligne: ${row.number}) : ${formData.nomEntreprise}`);
            } else {
                console.error('❌ Aucune feuille trouvée dans le classeur Excel.');
            }

        } catch (err) {
            console.error('❌ Erreur lors de la mise à jour Excel:', err.message);
            if (err.message.includes('EBUSY')) {
                console.error('👉 Veuillez vérifier que le fichier Excel n\'est pas ouvert dans une autre application.');
            }
        }



        // 3. Envoi du mail via Brevo
        if (BREVO_API_KEY) {
            try {
                const pdfContent = pdfBase64.split(',')[1];

                // 1. Mail principal à l'opérateur (avec Pièce Jointe)
                await axios.post('https://api.brevo.com/v3/smtp/email', {
                    sender: { name: "Portail EBICS Axylis", email: "communication@axylis.email" },
                    to: [{ email: process.env.DEST_EMAIL || "communication@axylis.fr" }],
                    attachment: [{ content: pdfContent, name: fileName }],
                    subject: `Demande EBICS : ${formData.nomEntreprise} (${formData.numDossier})`,
                    htmlContent: `
                        <html>
                        <body style="font-family: sans-serif; line-height: 1.6;">
                            <h2 style="color: #E84924;">Nouvelle demande d'ouverture EBICS</h2>
                            <p>Bonjour,</p>
                            <p>Une nouvelle demande a été déposée par <strong>${formData.trigramme}</strong> (${formData.agence}).</p>
                            <p><strong>Entreprise :</strong> ${formData.nomEntreprise}<br>
                            <strong>Dossier :</strong> ${formData.numDossier}</p>
                            <hr>
                            <p style="background: #f4f4f4; padding: 15px; border-radius: 8px;">
                                <strong>📁 Éléments à disposition :</strong><br>
                                - Le récapitulatif signé et le RIB sont <strong>en pièce jointe</strong> de ce mail.<br>
                                - Archivage : <code>DEPOT_EBICS/${fileName}</code><br>
                                - Le fichier Excel de suivi a été mis à jour.
                            </p>
                            <p>Merci de traiter cette demande dès que possible.</p>
                        </body>
                        </html>
                    `
                }, { headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json' } });

                // 2. Accusé de réception au collaborateur
                if (formData.emailCollaborateur) {
                    await axios.post('https://api.brevo.com/v3/smtp/email', {
                        sender: { name: "Portail EBICS Axylis", email: "communication@axylis.email" },
                        to: [{ email: formData.emailCollaborateur }],
                        subject: `Confirmation de demande EBICS : ${formData.nomEntreprise}`,
                        htmlContent: `
                            <html>
                            <body style="font-family: sans-serif; line-height: 1.6;">
                                <h2 style="color: #0b203c;">Demande EBICS enregistrée</h2>
                                <p>Bonjour ${formData.trigramme},</p>
                                <p>Ceci est un accusé de réception confirmant le dépôt de votre demande EBICS pour le dossier : <strong>${formData.numDossier} - ${formData.nomEntreprise}</strong>.</p>
                                <p>Votre demande a été archivée et transmise au service opérateur pour traitement.</p>
                                <p>Cordialement,<br>L'équipe Axylis</p>
                            </body>
                            </html>
                        `
                    }, { headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json' } });
                }

                console.log('Emails envoyés avec succès.');
            } catch (mailErr) {
                console.error('Erreur BrevoDetails:', mailErr.response ? mailErr.response.data : mailErr.message);
                throw new Error('Echec de l\'envoi des mails de notification');
            }
        }

        res.json({ success: true, message: 'Demande enregistrée et archivée' });

    } catch (error) {
        console.error('Erreur serveur:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`🚀 Serveur d'automation prêt sur le port ${PORT}`);
    console.log(`📁 Dossier de dépôt : ${DEPOT_PATH}`);
    console.log(`📊 Fichier Excel : ${EXCEL_PATH}`);
    console.log(`📧 Destination : ${process.env.DEST_EMAIL || "communication@axylis.fr"}`);
});
