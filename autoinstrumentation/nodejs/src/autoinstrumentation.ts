import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-grpc';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { alibabaCloudEcsDetector } from '@opentelemetry/resource-detector-alibaba-cloud';
import { awsEc2Detector, awsEksDetector } from '@opentelemetry/resource-detector-aws';
import { containerDetector } from '@opentelemetry/resource-detector-container';
import { gcpDetector } from '@opentelemetry/resource-detector-gcp';
import { envDetector, hostDetector, osDetector, processDetector } from '@opentelemetry/resources';
import { context, diag } from '@opentelemetry/api';
import { getRPCMetadata } from '@opentelemetry/core';

import { NodeSDK } from '@opentelemetry/sdk-node';

import { IncomingMessage } from 'http';

function getMetricReader() {
  switch (process.env.OTEL_METRICS_EXPORTER) {
    case undefined:
    case '':
    case 'otlp':
      diag.info('using otel metrics exporter');
      return new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter(),
        exportIntervalMillis: parseInt(process.env.OTEL_METRIC_EXPORT_INTERVAL || '60000', 10)
      });
    case 'prometheus':
      diag.info('using prometheus metrics exporter');
      return new PrometheusExporter({});
    case 'none':
      diag.info('disabling metrics reader');
      return undefined;
    default:
      throw Error(`no valid option for OTEL_METRICS_EXPORTER: ${process.env.OTEL_METRICS_EXPORTER}`);
  }
}

const matchPath = (path: string) => {
  const regex = /(favicon\.ico|_next|static)/;
  return !regex.test(path);
}
const pathPrefix = process.env.PATH_PREFIX || '';

const sdk = new NodeSDK({
  autoDetectResources: true,
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-dns': {
        enabled: false
      },
      '@opentelemetry/instrumentation-fs': {
        enabled: false
      },
      '@opentelemetry/instrumentation-http': {
        requestHook: (span, req) => {
          if (req instanceof IncomingMessage) {
            if (span && req.url) {
              const url = (pathPrefix && !req.url.startsWith(pathPrefix)) ? `${pathPrefix}${req.url}` : req.url;
              const route = matchPath(url) ? url : '';

              if (route) {
                const rpcMetadata = getRPCMetadata(context.active());
                if (rpcMetadata) {
                  rpcMetadata.route = route;
                }
                span.setAttribute('resource.name', `${req.method || 'GET'} ${route}`);
              }
            }
          }
        },
      },
      '@opentelemetry/instrumentation-net': {
        enabled: false
      },
    })
  ],
  traceExporter: new OTLPTraceExporter(),
  metricReader: getMetricReader(),
  resourceDetectors: 
    [
      // Standard resource detectors.
      containerDetector,
      envDetector,
      hostDetector,
      osDetector,
      processDetector,

      // Cloud resource detectors.
      alibabaCloudEcsDetector,
      // Ordered AWS Resource Detectors as per:
      // https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/processor/resourcedetectionprocessor/README.md#ordering
      awsEksDetector,
      awsEc2Detector,
      gcpDetector,
    ],
});

sdk.start();
