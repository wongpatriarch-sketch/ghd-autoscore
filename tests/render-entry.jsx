import React from 'react'
import Workspace from '../src/components/Workspace.jsx'
import Dashboard from '../src/pages/Dashboard.jsx'
import EventScoring from '../src/pages/EventScoring.jsx'
import BatchImport from '../src/pages/BatchImport.jsx'
import HistoryCenter from '../src/pages/History.jsx'
import ProjectHub from '../src/pages/ProjectHub.jsx'

export const pages = { Workspace, Dashboard, EventScoring, BatchImport, HistoryCenter, ProjectHub }
export { parseNames, summaryNote } from '../src/lib/utils.js'
export { validateEventForm, computeEventScores, countCards } from '../src/lib/eventForm.js'
export { React }
