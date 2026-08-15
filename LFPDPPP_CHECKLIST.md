# Checklist de Privacidad y Cumplimiento de la Ley (LFPDPPP) - AmConnect

Este documento contiene la guía obligatoria de configuraciones técnicas y requisitos legales que deben mantenerse en AmConnect para cumplir con la **Ley Federal de Protección de Datos Personales en Posesión de los Particulares (LFPDPPP)** de México.

---

## 1. Configuraciones de Google Cloud (GCP) y Vertex AI

### A. Logs de Acceso a Datos (Data Access Logs) - DESACTIVADOS
* **Estado:** Debe mantenerse desactivado por defecto a nivel de proyecto para evitar que Cloud Logging almacene en texto plano los documentos o conversaciones procesados por la IA.
* **Verificación:** En la consola de GCP, ve a **IAM y administración** > **Registros de auditoría** (Audit Logs). Para el servicio **Vertex AI API**, las opciones de **`Data Read`** (Lectura de datos) y **`Data Write`** (Escritura de datos) deben permanecer **desmarcadas**.

### B. Privilegios Mínimos de IAM (Cuentas de Servicio)
* **Estado:** La cuenta de servicio del backend (`FIREBASE_SERVICE_ACCOUNT` y similares) no debe tener roles de administración general (como Editor o Propietario).
* **Configuración:** Solo debe tener asignados los roles de **Usuario de Agent Platform** o **Usuario de Vertex AI** (`roles/aiplatform.user`), y **Creador de tokens de cuenta de servicio**.

### C. Residencia de Datos (Región)
* **Estado:** Las llamadas a la API de Vertex se procesan en la región `us-central1` y los embeddings a través del endpoint multi-regional `us` (`aiplatform.us.rep.googleapis.com`). Esto debe documentarse con total transparencia en el Aviso de Privacidad como transferencia internacional de datos.

---

## 2. Configuraciones de Supabase (Base de datos y Storage)

### A. Políticas de RLS en Storage (Bucket `policies`)
* **Estado:** El bucket `policies` que almacena los PDFs de los clientes **debe ser privado** (`public = false`).
* **RLS (Row Level Security):** Se impone la estructura de carpetas `{agent_id}/{nombre_archivo}`. Las políticas en `storage.objects` deben validar estrictamente que `auth.uid()::text = (storage.foldername(name))[1]` para que ningún asesor pueda ver o descargar archivos de otro.

### B. Logs de Depuración en el Backend
* **Estado:** Queda **estrictamente prohibido** dejar en código `console.log` que impriman contenidos de prompts, cuerpos de documentos o respuestas de la IA. Los logs operativos permitidos son solo errores (`console.error`) con etiquetas operativas y sin datos del cliente.

---

## 3. Requisitos Legales y Funcionales (App & Web)

### A. Aviso de Privacidad Accesible
* El **Aviso de Privacidad Integral** debe estar visible en:
  1. La pantalla de Login / Registro.
  2. La sección de Configuración dentro de la app móvil.
  3. El sitio web público del proyecto.

### B. Contenido Mínimo Obligatorio del Aviso de Privacidad
* **Identidad y Domicilio:** Identificar al responsable del tratamiento de los datos.
* **Datos Recabados:** Indicar que se recopilan datos de identificación, patrimoniales y financieros contenidos en pólizas de seguros.
* **Finalidades Primarias:** Proveer el servicio de asistencia, extracción automática y cotización/administración de cartera de seguros.
* **Transferencias:** Declarar el procesamiento y almacenamiento seguro a través de los servidores de Supabase y Google Cloud Vertex AI en EE. UU., bajo estrictos estándares de cifrado y aislamiento.
* **Derechos ARCO:** Proveer un medio claro (ej. un correo electrónico) para que los usuarios puedan solicitar el Acceso, Rectificación, Cancelación u Oposición de sus datos.

### C. Mecanismo de Consentimiento Explicito
* En la pantalla de registro de asesores, debe requerirse una casilla de verificación (checkbox) de aceptación obligatoria: *"He leído y acepto el Aviso de Privacidad"* antes de permitir la creación de cuentas o la subida de cualquier archivo.
