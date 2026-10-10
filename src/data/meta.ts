import type { BeamlineMeta } from './types';

/**
 * Presentation metadata for the nine APS-U feature beamlines (order = tour order, by sector).
 * displayName expands the acronym only (checked against each dossier's fullName and the APS feature-beamline pages);
 * stations lists the experiment stations (APS Beamline Directory / sector research).
 */
export const FEATURE_META: BeamlineMeta[] = [
  { id: 'polar', sectorNumber: 4, color: '#c084fc', displayName: 'Polarization Modulation Spectroscopy', stations: '4-ID-B, G, H', short: 'Magnetism & polarization', explainers: ['xmcd'] },
  { id: 'xpcs', sectorNumber: 8, color: '#38bdf8', displayName: 'X-ray Photon Correlation Spectroscopy', stations: '8-ID-E, I', short: 'Dynamics with coherent X-rays', explainers: ['xpcs'] },
  { id: 'cssi', sectorNumber: 9, color: '#34d399', displayName: 'Coherent Surface Scattering Imaging', stations: '9-ID-D', short: 'Surfaces & thin films', explainers: ['gisaxs'] },
  { id: 'isn', sectorNumber: 19, color: '#f472b6', displayName: 'In Situ Nanoprobe', stations: '19-ID-E', short: 'Nanoscale chemistry in action', explainers: ['nanoprobe'] },
  { id: 'hexm', sectorNumber: 20, color: '#fb923c', displayName: 'High-Energy X-ray Microscope', stations: '20-ID-D, E', short: 'Inside bulk materials', explainers: ['hedm'] },
  { id: 'chex', sectorNumber: 28, color: '#facc15', displayName: 'Coherent High-Energy X-ray', stations: '28-ID-B, C, D, E, F, G', short: 'Chemistry & materials in situ', explainers: ['coherence'] },
  { id: 'ptychoprobe', sectorNumber: 33, color: '#60a5fa', displayName: 'Ptychography + X-ray Fluorescence Nanoprobe', stations: '33-ID-C', short: 'Ultimate-resolution imaging', explainers: ['ptycho'] },
  { id: '3dmn', sectorNumber: 34, color: '#2dd4bf', displayName: '3D Micro & Nano Diffraction', stations: '34-ID-E', short: '3D crystal maps (Laue)', explainers: ['laue'] },
  { id: 'atomic', sectorNumber: 34, color: '#fb7185', displayName: 'Bragg Coherent Diffraction Imaging', stations: '34-ID-F', short: 'Strain inside nanocrystals', explainers: ['bcdi'] },
];

export const metaById = (id: string): BeamlineMeta | undefined => FEATURE_META.find((m) => m.id === id);
