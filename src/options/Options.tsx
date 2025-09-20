// src/options/Options.tsx

import React, { useState, useEffect } from 'react';
import { initializeVault, isVaultInitialized } from '../vault';

const Options = () => {
  const [url, setUrl] = useState('');
  const [googleApiKey, setGoogleApiKey] = useState('');
  const [defaultLocation, setDefaultLocation] = useState('');
  const [status, setStatus] = useState('');
  const [version, setVersion] = useState('');

  // Vault state
  const [passphrase, setPassphrase] = useState('');
  const [vaultInitialized, setVaultInitialized] = useState(false);
  const [vaultStatus, setVaultStatus] = useState('');

  // Load saved settings and version from manifest when the component mounts
  useEffect(() => {
    // Check if the chrome API is available before using it
    if (window.chrome && chrome.runtime && chrome.runtime.getManifest) {
      // Fetch the extension version from the manifest
      const manifest = chrome.runtime.getManifest();
      setVersion(manifest.version);
    }

    if (window.chrome && chrome.storage && chrome.storage.sync) {
        chrome.storage.sync.get(['newTaskUrl', 'googleApiKey', 'defaultLocation'], (data) => {
          if (data.newTaskUrl) {
            setUrl(data.newTaskUrl);
          } else {
            // Set a default value if nothing is in storage
            setUrl('https://www.google.com');
          }
          if (data.googleApiKey) setGoogleApiKey(data.googleApiKey);
          if (data.defaultLocation) setDefaultLocation(data.defaultLocation);
        });
    }

    isVaultInitialized().then(setVaultInitialized);
  }, []);

  const handleSave = (event: React.FormEvent) => {
    event.preventDefault();

    let correctedUrl = url.trim();
    if (!correctedUrl.startsWith('http://') && !correctedUrl.startsWith('https://')) {
      correctedUrl = `https://${correctedUrl}`;
    }

    // Save all settings to Chrome's sync storage
    if (window.chrome && chrome.storage && chrome.storage.sync) {
        chrome.storage.sync.set({
          newTaskUrl: correctedUrl,
          googleApiKey: googleApiKey,
          defaultLocation: defaultLocation
        }, () => {
          setUrl(correctedUrl);
          setStatus('Settings saved!');
          setTimeout(() => setStatus(''), 2000);
        });
    } else {
        console.warn("Chrome storage API not available. Settings not saved.");
        setStatus('Error: Could not save settings.');
    }
  };

  const handleVaultSetup = async (event: React.FormEvent) => {
    event.preventDefault();
    if (passphrase.length < 8) {
      setVaultStatus('Error: Passphrase must be at least 8 characters long.');
      return;
    }
    try {
      await initializeVault(passphrase);
      setVaultInitialized(true);
      setPassphrase('');
      setVaultStatus('Vault successfully initialized and unlocked for this session!');
      setTimeout(() => setVaultStatus(''), 3000);
    } catch (error) {
      console.error("Vault initialization failed:", error);
      setVaultStatus('Error: Could not initialize vault.');
    }
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif', maxWidth: '600px', margin: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #eee', paddingBottom: '16px' }}>
        <h1 style={{ margin: 0 }}>Settings</h1>
        {version && <span style={{ color: '#555', fontSize: '14px' }}>Version {version}</span>}
      </div>

      <div style={{ borderBottom: '1px solid #eee', paddingBottom: '16px', marginBottom: '24px' }}>
        <h2 style={{ fontSize: '18px', marginTop: '24px' }}>Agent Settings</h2>
        <form onSubmit={handleSave}>
          <div style={{ marginBottom: '24px' }}>
            <label
              htmlFor="url-input"
              style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}
            >
              Default URL for New Tasks
            </label>
            <input
              type="text"
              id="url-input"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              style={{ width: '100%', padding: '8px', boxSizing: 'border-box', borderRadius: '4px', border: '1px solid #ccc' }}
            />
            <p style={{ fontSize: '12px', color: '#555', marginTop: '8px' }}>
              When the agent starts a new task unrelated to the current page, it will open this URL.
            </p>
          </div>

          <div style={{ marginBottom: '24px' }}>
            <label
              htmlFor="google-key-input"
              style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}
            >
              Google API Key
            </label>
            <input
              type="password"
              id="google-key-input"
              value={googleApiKey}
              onChange={(e) => setGoogleApiKey(e.target.value)}
              style={{ width: '100%', padding: '8px', boxSizing: 'border-box', borderRadius: '4px', border: '1px solid #ccc' }}
            />
            <p style={{ fontSize: '12px', color: '#555', marginTop: '8px' }}>
              Your Google API key with the "Generative Language API" enabled.
            </p>
          </div>

          <div style={{ marginBottom: '24px' }}>
            <label
              htmlFor="location-input"
              style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}
            >
              Default Location (Fallback)
            </label>
            <input
              type="text"
              id="location-input"
              value={defaultLocation}
              onChange={(e) => setDefaultLocation(e.target.value)}
              placeholder="e.g., Atlanta, GA"
              style={{ width: '100%', padding: '8px', boxSizing: 'border-box', borderRadius: '4px', border: '1px solid #ccc' }}
            />
            <p style={{ fontSize: '12px', color: '#555', marginTop: '8px' }}>
              Used as a fallback if automatic location detection is disabled or fails.
            </p>
          </div>

          <button
            type="submit"
            style={{ padding: '10px 15px', border: 'none', borderRadius: '4px', backgroundColor: '#007bff', color: 'white', cursor: 'pointer' }}
          >
            Save Settings
          </button>

          {status && <span style={{ marginLeft: '12px', color: 'green' }}>{status}</span>}
        </form>
      </div>

      <div>
        <h2 style={{ fontSize: '18px' }}>Secure Vault</h2>
        <p style={{ fontSize: '12px', color: '#555', marginTop: '8px' }}>
            The secure vault stores your sensitive data (like passwords or API keys) encrypted on your local machine.
            You must set a master passphrase to use this feature.
        </p>
        <form onSubmit={handleVaultSetup}>
             <div style={{ marginBottom: '24px' }}>
                <label
                    htmlFor="passphrase-input"
                    style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}
                >
                    {vaultInitialized ? 'Update Master Passphrase' : 'Create Master Passphrase'}
                </label>
                <input
                    type="password"
                    id="passphrase-input"
                    value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)}
                    placeholder="Enter a strong passphrase (min. 8 characters)"
                    style={{ width: '100%', padding: '8px', boxSizing: 'border-box', borderRadius: '4px', border: '1px solid #ccc' }}
                />
            </div>
            <button
              type="submit"
              style={{ padding: '10px 15px', border: 'none', borderRadius: '4px', backgroundColor: '#28a745', color: 'white', cursor: 'pointer' }}
            >
              {vaultInitialized ? 'Update and Re-lock Vault' : 'Initialize Vault'}
            </button>
            {vaultStatus && <span style={{ marginLeft: '12px', color: vaultStatus.startsWith('Error') ? 'red' : 'green' }}>{vaultStatus}</span>}
        </form>
         <div style={{ marginTop: '20px', padding: '12px', background: '#e7f3ff', borderRadius: '4px', border: '1px solid #b3d7ff' }}>
            <h3 style={{marginTop: 0, fontSize: '14px', color: '#004085'}}>How to use the Vault</h3>
            <p style={{fontSize: '12px', color: '#004085', margin: 0}}>
                If you want to store your secure keys for BeachdAI to act on your behalf, use the "teach me something" feature and visit your favorite websites. When you type in a password or other sensitive field, the agent will ask you to name and save it to your vault.
            </p>
        </div>
      </div>
    </div>
  );
};

export default Options;
