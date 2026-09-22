import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title:'Caçadores de Nichos — Radar editorial', description:'Descoberta, pesquisa e inteligência para novas propriedades de mídia.', icons:{icon:'/favicon.svg'} };
export default function RootLayout({children}:{children:React.ReactNode}) {return <html lang="pt-BR"><body>{children}</body></html>;}
