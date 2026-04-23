import React, { useState, useMemo, useEffect } from 'react'
import Tesseract from 'tesseract.js'
import * as pdfjsLib from 'pdfjs-dist'

// Import direct du worker pour Vite (version 4+)
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url'
import collaborateursData from '../collaborateurs.json'
import axylisLogo from '../axylis_logo.png'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker

function App() {
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const [debugText, setDebugText] = useState('')
  const [showErrors, setShowErrors] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [formData, setFormData] = useState({
    numDossier: '',
    nomEntreprise: '',
    siret: '',
    trigramme: '',
    emailCollaborateur: '',
    agence: '',
    logiciel: '',
    autreLogiciel: '',
    iban: '',
    bic: '',
    titulaireCompte: '',
    ribFile: null
  })

  // Sort collaborators by trigramme A-Z
  const sortedCollabs = useMemo(() => {
    return [...collaborateursData].sort((a, b) => a.trigramme.localeCompare(b.trigramme))
  }, [])

  const handleTrigramChange = (e) => {
    const val = e.target.value.toUpperCase()
    const collab = sortedCollabs.find(c => c.trigramme === val)
    if (collab) {
      setFormData({
        ...formData,
        trigramme: val,
        emailCollaborateur: collab.email,
        agence: (collab.agence || '').toUpperCase()
      })
    } else {
      setFormData({ ...formData, trigramme: val, agence: '', emailCollaborateur: '' })
    }
  }

  const extractData = (text) => {
    console.log("Extraction depuis :", text);
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    
    let iban = '';
    let bic = '';

    // 1. Recherche de l'IBAN (FR + 23 chiffres = 25 total)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].toUpperCase().replace(/[\s\.-]/g, '');
      const match = line.match(/FR[0-9]{23}/); 
      if (match) {
        iban = match[0];
        break;
      }
    }

    // 2. Recherche du BIC (8 ou 11 caractères, doit contenir FR pour la France)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].toUpperCase();
      if (line.includes('BIC') || line.includes('SWIFT')) {
         // On fusionne la ligne actuelle et la suivante, et on supprime TOUS les espaces
         const potentialArea = (line + (lines[i+1] || '')).replace(/BIC|SWIFT/g, '').replace(/\s/g, '');
         
         // Regex : 4 lettres + FR + 2 ou 5 caractères alphanumériques
         const bicMatches = potentialArea.match(/[A-Z]{4}FR[A-Z0-9]{2,5}/g);
         if (bicMatches) {
            const validBic = bicMatches.find(b => b.length === 8 || b.length === 11);
            if (validBic) {
              bic = validBic;
              break;
            }
         }
      }
    }

    return { iban, bic }
  }

  const handleFileUpload = async (e) => {
    const file = e.target.files[0]
    if (!file) return;

    setLoading(true)
    setStatus('Lecture du fichier...')
    setFormData({ ...formData, ribFile: file })
    
    try {
      let source = file;

      if (file.type === 'application/pdf') {
        setStatus('Conversion du PDF en image...')
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 2.5 });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        await page.render({ canvasContext: context, viewport }).promise;
        source = canvas.toDataURL('image/png');
      }

      setStatus('Analyse par l\'Intelligence Artificielle...')
      const { data: { text } } = await Tesseract.recognize(
        source,
        'fra',
        { logger: m => {
          if (m.status === 'recognizing text') {
            setStatus(`Lecture du document : ${Math.round(m.progress * 100)}%`)
          }
        }}
      );

      setDebugText(text); 
      const { iban, bic } = extractData(text);

      setFormData(prev => ({
        ...prev,
        iban: iban || prev.iban,
        bic: bic || prev.bic
      }));
      
      setStatus('');
    } catch (err) {
      console.error("Erreur OCR:", err);
      setStatus('Désolé, l\'IA n\'a pas pu lire ce document.');
    } finally {
      setLoading(false);
    }
  }


  const isFormValid = 
    formData.numDossier && 
    formData.nomEntreprise && 
    formData.trigramme && 
    formData.agence && 
    formData.iban && 
    formData.bic && 
    formData.titulaireCompte &&
    formData.logiciel && 
    (formData.logiciel !== 'Autres' || formData.autreLogiciel)

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!isFormValid) {
      setShowErrors(true)
      // On réinitialise l'erreur après un moment pour pouvoir "re-secouer"
      setTimeout(() => setShowErrors(false), 2000)
      return
    }
    setSubmitted(true)
  }

  const getErrorClass = (val) => (showErrors && !val) ? 'input-error' : ''

  if (submitted) {
    return (
      <div className="app-container">
        <div className="main-card fade-in" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '64px', marginBottom: '20px' }}>🎉</div>
          <h2>Demande Envoyée !</h2>
          <p style={{ marginTop: '15px', color: '#64748b' }}>
            La demande pour <strong>{formData.nomEntreprise}</strong> a été transmise.
          </p>
          <button className="btn" style={{ marginTop: '30px', width: 'auto', padding: '14px 40px', display: 'inline-flex' }} onClick={() => setSubmitted(false)}>Faire une nouvelle demande</button>
        </div>
      </div>
    )
  }

  return (
    <div className="app-container wide">
      <div className="main-card">
        <div className="header">
          <img src={axylisLogo} alt="Axylis" className="logo" />
          <h1>Demande Ouverture EBICS</h1>
          <p className="subtitle">Formulaire officiel de demande de remontées bancaires</p>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          {/* Section 1: Le Dossier */}
          <div className="section-title">1. Informations du Dossier</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr', gap: '20px', marginBottom: '20px' }}>
            <div>
              <label className="label">Numéro de dossier</label>
              <input 
                type="text" 
                className={getErrorClass(formData.numDossier)}
                placeholder="Ex: MED60352" 
                value={formData.numDossier} 
                onChange={e => setFormData({...formData, numDossier: e.target.value.toUpperCase()})} 
                required 
              />
            </div>
            <div>
              <label className="label">Nom de l'entreprise</label>
              <input 
                type="text" 
                className={getErrorClass(formData.nomEntreprise)}
                placeholder="Raison sociale" 
                value={formData.nomEntreprise} 
                onChange={e => setFormData({...formData, nomEntreprise: e.target.value.toUpperCase()})} 
                required 
              />
            </div>
            <div>
              <label className="label">SIRET</label>
              <input 
                type="text" 
                className={getErrorClass(formData.siret)}
                placeholder="14 chiffres" 
                value={formData.siret} 
                maxLength="14"
                onChange={e => {
                  const val = e.target.value.replace(/\D/g, '');
                  setFormData({...formData, siret: val});
                }} 
              />
            </div>
          </div>

          {/* Section 2: Collaborateur */}
          <div className="section-title">2. Collaborateurs & Agence</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '20px', marginBottom: '20px' }}>
            <div>
              <label className="label">Trigramme</label>
              <select 
                value={formData.trigramme}
                onChange={handleTrigramChange}
                required
                className={`input-field ${getErrorClass(formData.trigramme)}`}
                style={{ textTransform: 'uppercase' }}
              >
                <option value="">Sélectionnez...</option>
                {sortedCollabs.map(c => <option key={c.trigramme} value={c.trigramme}>{c.trigramme}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Agence</label>
              <input type="text" className={getErrorClass(formData.agence)} value={formData.agence} readOnly placeholder="Sélectionnez un trigramme" style={{ background: '#f8fafc', textTransform: 'uppercase' }} />
            </div>
          </div>

          {/* Section 3: Banque (IA) */}
          <div className="section-title">3. Coordonnées Bancaires</div>
          <div className="upload-zone" onClick={() => document.getElementById('rib-input').click()} style={{ padding: '30px' }}>
            <div className="upload-icon">🏦</div>
            <div className="upload-text">
              <p>{formData.ribFile ? formData.ribFile.name : 'Déposez votre RIB pour une extraction automatique IA'}</p>
              <span>(Optionnel si rempli manuellement)</span>
            </div>
            <input id="rib-input" type="file" hidden onChange={handleFileUpload} accept=".pdf,image/*" />
          </div>

          {loading && (
            <div className="status-area" style={{ display: 'block', marginBottom: '20px' }}>
              <div className="progress-bar"><div className="progress-inner" style={{ width: '100%', animation: 'loading 2s infinite' }}></div></div>
              <p className="status-text">{status}</p>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px', marginBottom: '20px' }}>
             <div>
              <label className="label">TITULAIRE DU COMPTE</label>
              <input 
                type="text" 
                className={getErrorClass(formData.titulaireCompte)}
                placeholder="NOM SUR LE RIB" 
                value={formData.titulaireCompte} 
                onChange={e => setFormData({...formData, titulaireCompte: e.target.value.toUpperCase()})} 
                required 
              />
            </div>
            <div>
              <label className="label">IBAN</label>
              <input 
                type="text" 
                className={getErrorClass(formData.iban)}
                placeholder="FR..." 
                value={formData.iban} 
                onChange={e => setFormData({...formData, iban: e.target.value.toUpperCase().replace(/\s/g, '')})} 
                required 
              />
            </div>
            <div>
              <label className="label">BIC</label>
              <input 
                type="text" 
                className={getErrorClass(formData.bic)}
                placeholder="BIC/SWIFT" 
                value={formData.bic} 
                onChange={e => setFormData({...formData, bic: e.target.value.toUpperCase().replace(/\s/g, '')})} 
                required 
              />
            </div>
          </div>

          {/* Section 4: Logiciel */}
          <div className="section-title">4. Logiciel de Production</div>
          <div style={{ display: 'grid', gridTemplateColumns: formData.logiciel === 'Autres' ? '1fr 1fr' : '1fr', gap: '20px', marginBottom: '30px' }}>
            <select 
              className={`input-field ${getErrorClass(formData.logiciel)}`} 
              value={formData.logiciel} 
              onChange={e => setFormData({...formData, logiciel: e.target.value})} 
              required 
              style={{ textTransform: 'uppercase' }}
            >
              <option value="">SÉLECTIONNEZ LE LOGICIEL UTILISÉ...</option>
              <option value="MyAxylis">MYAXYLIS</option>
              <option value="ISA">ISA</option>
              <option value="ACD">ACD</option>
              <option value="Autres">AUTRES</option>
            </select>

            {formData.logiciel === 'Autres' && (
              <input 
                type="text" 
                className={getErrorClass(formData.autreLogiciel)}
                placeholder="PRÉCISEZ LE LOGICIEL" 
                value={formData.autreLogiciel} 
                onChange={e => setFormData({...formData, autreLogiciel: e.target.value.toUpperCase()})} 
                required 
              />
            )}
          </div>

          <button type="submit" className="btn submit-btn" disabled={loading}>
            Valider et transmettre la demande EBICS ✓
          </button>
          
          {debugText && (
            <div style={{ marginTop: '20px', fontSize: '12px', color: '#94a3b8', textAlign: 'center' }}>
              <details>
                <summary style={{ cursor: 'pointer', textDecoration: 'underline' }}>Afficher le texte extrait par l'IA (Débogage)</summary>
                <pre style={{ textAlign: 'left', background: '#f1f5f9', padding: '10px', borderRadius: '8px', marginTop: '10px', whiteSpace: 'pre-wrap' }}>
                  {debugText}
                </pre>
              </details>
            </div>
          )}
        </form>
      </div>

      <style>{`
        .app-container.wide { max-width: 1000px; width: 95%; }
        .section-title { font-weight: bold; color: var(--secondary-color); margin: 40px 0 20px 0; font-size: 1.2rem; border-left: 4px solid var(--primary-color); padding-left: 15px; }
        .input-field, input[type="text"], select { width: 100%; padding: 14px 18px; border-radius: 12px; border: 1px solid #e2e8f0; outline: none; font-size: 1rem; transition: var(--transition); }
        .input-field:focus, input[type="text"]:focus { border-color: var(--primary-color); box-shadow: 0 0 0 3px rgba(232, 73, 36, 0.1); }
        .submit-btn { height: 65px; font-size: 1.2rem; text-transform: uppercase; letter-spacing: 1px; }
        @keyframes loading { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }
        @media (max-width: 768px) { div { grid-template-columns: 1fr !important; } }
      `}</style>
    </div>
  )
}

export default App
