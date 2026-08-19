DROP POLICY IF EXISTS stock_receipts_service_role ON public.stock_receipts;
DROP POLICY IF EXISTS supplier_payments_service_role ON public.supplier_payments;
DROP POLICY IF EXISTS purchases_service_role ON public.purchases;
DROP POLICY IF EXISTS expenses_service_role ON public.expenses;
DROP POLICY IF EXISTS suppliers_service_role ON public.suppliers;
DROP POLICY IF EXISTS extracted_records_service_role ON public.extracted_records;
DROP POLICY IF EXISTS extraction_jobs_service_role ON public.extraction_jobs;
DROP POLICY IF EXISTS media_inputs_service_role ON public.media_inputs;

DROP TABLE IF EXISTS public.stock_receipts;
DROP TABLE IF EXISTS public.supplier_payments;
DROP TABLE IF EXISTS public.purchases;
DROP TABLE IF EXISTS public.expenses;
DROP TABLE IF EXISTS public.suppliers;
DROP TABLE IF EXISTS public.extracted_records;
DROP TABLE IF EXISTS public.extraction_jobs;
DROP TABLE IF EXISTS public.media_inputs;
